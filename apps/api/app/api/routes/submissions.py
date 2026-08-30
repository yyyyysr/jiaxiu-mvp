from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from starlette.background import BackgroundTask
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException

from app.api.dependencies.auth import require_contributor, require_contributor_csrf
from app.core.config import Settings
from app.db import connect_readonly
from app.repositories.submissions import (
    SubmissionNotEditableError,
    SubmissionNotFoundError,
    create_submission,
    get_owned_submission,
    get_owned_submission_file,
    list_owned_submissions,
    resubmit_owned_submission,
    update_owned_submission,
)
from app.repositories.works import get_work
from app.schemas.submissions import (
    SubmissionCreateFields,
    SubmissionPatch,
    SubmissionResponse,
    SubmissionType,
)
from app.services.auth import Principal
from app.services.submission_files import (
    UploadSizeLimitError,
    iter_open_file,
    open_staged_file,
    remove_staged_submission,
    stage_uploads,
)
from app.services.submission_multipart import (
    SubmissionBodyTooLargeError,
    SubmissionFilePartTooLargeError,
    SubmissionTooManyFieldsError,
    SubmissionTooManyFilesError,
    parse_submission_form,
)

router = APIRouter(prefix="/submissions", tags=["submissions"])


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "submission_not_found", "message": "未找到投稿。"},
    )


def _normalize(value: str | None) -> str:
    return value.strip() if value else ""


def _validate_shape(
    settings: Settings,
    *,
    submission_type: str,
    existing_work_id: str | None,
    title: str,
    authors: str,
    poem_text: str,
    genre: str,
    historical_period: str,
    file_count: int,
) -> SubmissionType:
    if submission_type not in {"new_work", "existing_work_scan"}:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_submission_type", "message": "投稿类型无效。"},
        )
    if submission_type == "new_work":
        if existing_work_id:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "existing_work_id_not_allowed",
                    "message": "新作品投稿不能关联已有作品标识。",
                },
            )
        if not title and not poem_text:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "submission_content_required",
                    "message": "新作品投稿需提供题名或正文。",
                },
            )
        return "new_work"
    if any((title, authors, poem_text, genre, historical_period)):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "metadata_not_allowed",
                "message": "已有作品扫描投稿不能包含新作品元数据。",
            },
        )
    if not existing_work_id:
        raise HTTPException(
            status_code=422,
            detail={"code": "existing_work_id_required", "message": "需提供已有作品标识。"},
        )
    with connect_readonly(settings) as connection:
        exists = (
            get_work(
                connection,
                existing_work_id,
                False,
                settings.facsimile_root,
                settings=settings,
            )
            is not None
        )
    if not exists:
        raise HTTPException(
            status_code=404,
            detail={"code": "work_not_found", "message": "未找到要关联的公开作品。"},
        )
    if file_count == 0:
        raise HTTPException(
            status_code=422,
            detail={"code": "files_required", "message": "已有作品扫描投稿需上传影像。"},
        )
    return "existing_work_scan"


def _editable_error(error: Exception) -> HTTPException:
    if isinstance(error, SubmissionNotFoundError):
        return _not_found()
    return HTTPException(
        status_code=409,
        detail={"code": "submission_not_editable", "message": "当前投稿状态不可修改。"},
    )


def _multipart_http_error(error: Exception) -> HTTPException:
    if isinstance(error, (SubmissionBodyTooLargeError, SubmissionFilePartTooLargeError)):
        return HTTPException(
            status_code=413,
            detail={"code": "upload_too_large", "message": "投稿请求超过上传上限。"},
        )
    if isinstance(error, SubmissionTooManyFilesError):
        code = "too_many_files"
        message = "每次投稿最多上传 10 个影像文件。"
    elif isinstance(error, SubmissionTooManyFieldsError):
        code = "too_many_fields"
        message = "投稿表单字段过多。"
    else:
        code = "invalid_multipart"
        message = "投稿表单格式无效。"
    return HTTPException(status_code=422, detail={"code": code, "message": message})


@router.post("", response_model=SubmissionResponse, status_code=201)
async def submissions_create(
    request: Request,
    principal: Annotated[Principal, Depends(require_contributor_csrf)],
) -> SubmissionResponse:
    settings: Settings = request.app.state.settings
    try:
        form = await parse_submission_form(request)
    except (SubmissionBodyTooLargeError, MultiPartException) as error:
        raise _multipart_http_error(error) from None
    try:
        raw_fields: dict[str, str] = {}
        uploads: list[UploadFile] = []
        for field_name, value in form.multi_items():
            if isinstance(value, UploadFile):
                if field_name != "files":
                    raise _multipart_http_error(MultiPartException("Unexpected file field"))
                uploads.append(value)
            else:
                if field_name in raw_fields:
                    raise _multipart_http_error(MultiPartException("Duplicate form field"))
                raw_fields[field_name] = value
        try:
            fields = SubmissionCreateFields.model_validate(raw_fields)
        except ValidationError:
            raise HTTPException(
                status_code=422,
                detail={"code": "validation_error", "message": "请求参数或内容无效。"},
            ) from None
        normalized_existing_id = _normalize(fields.existing_work_id) or None
        normalized_title = _normalize(fields.title)
        normalized_authors = _normalize(fields.authors)
        normalized_poem = _normalize(fields.poem_text)
        normalized_genre = _normalize(fields.genre)
        normalized_period = _normalize(fields.historical_period)
        resolved_type = _validate_shape(
            settings,
            submission_type=fields.submission_type.strip(),
            existing_work_id=normalized_existing_id,
            title=normalized_title,
            authors=normalized_authors,
            poem_text=normalized_poem,
            genre=normalized_genre,
            historical_period=normalized_period,
            file_count=len(uploads),
        )
        submission_id = uuid4().hex
        try:
            staged = await stage_uploads(settings, submission_id, uploads)
        except UploadSizeLimitError as error:
            raise HTTPException(
                status_code=413,
                detail={"code": "upload_too_large", "message": str(error)},
            ) from None
        except ValueError as error:
            raise HTTPException(
                status_code=422,
                detail={"code": "invalid_file", "message": str(error)},
            ) from None
        try:
            return create_submission(
                settings,
                submission_id=submission_id,
                owner_user_id=principal.user_id,
                submission_type=resolved_type,
                existing_work_id=normalized_existing_id,
                title=normalized_title,
                authors=normalized_authors,
                poem_text=normalized_poem,
                genre=normalized_genre,
                historical_period=normalized_period,
                notes=_normalize(fields.notes),
                files=staged,
            )
        except BaseException:
            remove_staged_submission(settings, submission_id)
            raise
    finally:
        await form.close()


@router.get("", response_model=list[SubmissionResponse])
def submissions_list(
    request: Request,
    principal: Annotated[Principal, Depends(require_contributor)],
) -> list[SubmissionResponse]:
    return list_owned_submissions(request.app.state.settings, principal.user_id)


@router.get("/{submission_id}", response_model=SubmissionResponse)
def submissions_detail(
    submission_id: str,
    request: Request,
    principal: Annotated[Principal, Depends(require_contributor)],
) -> SubmissionResponse:
    submission = get_owned_submission(request.app.state.settings, submission_id, principal.user_id)
    if submission is None:
        raise _not_found()
    return submission


@router.patch("/{submission_id}", response_model=SubmissionResponse)
def submissions_update(
    submission_id: str,
    payload: SubmissionPatch,
    request: Request,
    principal: Annotated[Principal, Depends(require_contributor_csrf)],
) -> SubmissionResponse:
    settings: Settings = request.app.state.settings
    current = get_owned_submission(settings, submission_id, principal.user_id)
    if current is None:
        raise _not_found()
    if current.status != "needs_revision":
        raise _editable_error(SubmissionNotEditableError())
    raw_changes = payload.model_dump(exclude_unset=True)
    changes = {
        field: (_normalize(value) if value is not None else None)
        for field, value in raw_changes.items()
    }
    candidate = current.model_copy(update=changes)
    _validate_shape(
        settings,
        submission_type=candidate.submission_type,
        existing_work_id=candidate.existing_work_id,
        title=candidate.title,
        authors=candidate.authors,
        poem_text=candidate.poem_text,
        genre=candidate.genre,
        historical_period=candidate.historical_period,
        file_count=len(candidate.files),
    )
    try:
        return update_owned_submission(
            settings,
            submission_id=submission_id,
            owner_user_id=principal.user_id,
            changes=changes,
        )
    except (SubmissionNotFoundError, SubmissionNotEditableError) as error:
        raise _editable_error(error) from None


@router.post("/{submission_id}/resubmit", response_model=SubmissionResponse)
def submissions_resubmit(
    submission_id: str,
    request: Request,
    principal: Annotated[Principal, Depends(require_contributor_csrf)],
) -> SubmissionResponse:
    settings: Settings = request.app.state.settings
    current = get_owned_submission(settings, submission_id, principal.user_id)
    if current is None:
        raise _not_found()
    if current.status != "needs_revision":
        raise _editable_error(SubmissionNotEditableError())
    _validate_shape(
        settings,
        submission_type=current.submission_type,
        existing_work_id=current.existing_work_id,
        title=current.title,
        authors=current.authors,
        poem_text=current.poem_text,
        genre=current.genre,
        historical_period=current.historical_period,
        file_count=len(current.files),
    )
    try:
        return resubmit_owned_submission(
            settings,
            submission_id=submission_id,
            owner_user_id=principal.user_id,
            request_id=request.state.request_id,
        )
    except (SubmissionNotFoundError, SubmissionNotEditableError) as error:
        raise _editable_error(error) from None


@router.get("/{submission_id}/files/{file_id}")
def submissions_file(
    submission_id: str,
    file_id: str,
    request: Request,
    principal: Annotated[Principal, Depends(require_contributor)],
):
    settings: Settings = request.app.state.settings
    record = get_owned_submission_file(settings, submission_id, file_id, principal.user_id)
    if record is None:
        raise _not_found()
    opened = open_staged_file(settings, submission_id, record)
    if opened is None:
        raise _not_found()
    response = StreamingResponse(
        iter_open_file(opened.file),
        media_type=opened.media_type,
        headers={
            "Content-Length": str(opened.file_bytes),
            "Content-Disposition": (f'inline; filename="{record.file_id}.{opened.extension}"'),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
        background=BackgroundTask(opened.file.close),
    )
    return response
