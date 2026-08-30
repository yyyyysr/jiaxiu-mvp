from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from app.api.dependencies.auth import require_admin, require_admin_csrf
from app.core.config import Settings
from app.repositories.submissions import (
    InvalidFileSelectionError,
    PublishValidationError,
    SubmissionAlreadyDecidedError,
    SubmissionNotFoundError,
    decide_admin_submission_with_reason,
    get_admin_submission,
    get_admin_submission_file,
    list_admin_submissions,
    publish_admin_submission,
    sweep_submission_file_cleanup,
    update_admin_submission,
)
from app.repositories.users import normalize_username
from app.schemas.admin import (
    AdminSubmissionDetail,
    AdminSubmissionPatch,
    AdminSubmissionQueueResponse,
    ModerationReasonRequest,
)
from app.schemas.submissions import SubmissionStatus, SubmissionType
from app.services.auth import Principal
from app.services.submission_files import iter_open_file, open_staged_file

router = APIRouter(prefix="/admin/submissions", tags=["admin-submissions"])


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "submission_not_found", "message": "未找到投稿。"},
    )


def _already_decided() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"code": "submission_already_decided", "message": "该投稿已完成处理。"},
    )


@router.get("", response_model=AdminSubmissionQueueResponse)
def submissions_queue(
    request: Request,
    _principal: Annotated[Principal, Depends(require_admin)],
    status: SubmissionStatus = "pending",
    submission_type: SubmissionType | None = None,
    owner_username: Annotated[str | None, Query(max_length=200)] = None,
    submitted_from: datetime | None = None,
    submitted_to: datetime | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> AdminSubmissionQueueResponse:
    if any(
        value is not None and (value.tzinfo is None or value.utcoffset() is None)
        for value in (submitted_from, submitted_to)
    ):
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "投稿日期必须包含时区。"},
        )
    normalized_from = submitted_from.astimezone(UTC) if submitted_from is not None else None
    normalized_to = submitted_to.astimezone(UTC) if submitted_to is not None else None
    if (
        normalized_from is not None
        and normalized_to is not None
        and normalized_from > normalized_to
    ):
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_date_range", "message": "投稿日期范围无效。"},
        )
    normalized_owner = None
    if owner_username is not None:
        normalized_owner = normalize_username(owner_username.strip())
        if not normalized_owner:
            raise HTTPException(
                status_code=422,
                detail={"code": "invalid_owner_username", "message": "投稿人用户名无效。"},
            )
    return list_admin_submissions(
        request.app.state.settings,
        status=status,
        submission_type=submission_type,
        owner_username_normalized=normalized_owner,
        submitted_from=normalized_from.isoformat() if normalized_from else None,
        submitted_to=normalized_to.isoformat() if normalized_to else None,
        page=page,
        page_size=page_size,
    )


@router.get("/{submission_id}", response_model=AdminSubmissionDetail)
def submissions_detail(
    submission_id: str,
    request: Request,
    _principal: Annotated[Principal, Depends(require_admin)],
) -> AdminSubmissionDetail:
    submission = get_admin_submission(request.app.state.settings, submission_id)
    if submission is None:
        raise _not_found()
    return submission


@router.patch("/{submission_id}", response_model=AdminSubmissionDetail)
def submissions_update(
    submission_id: str,
    payload: AdminSubmissionPatch,
    request: Request,
    principal: Annotated[Principal, Depends(require_admin_csrf)],
) -> AdminSubmissionDetail:
    raw = payload.model_dump(exclude_unset=True)
    metadata_changes = {
        field: value.strip()
        for field, value in raw.items()
        if field in {"title", "authors", "poem_text", "genre", "historical_period", "notes"}
    }
    try:
        submission, removed_records = update_admin_submission(
            request.app.state.settings,
            submission_id=submission_id,
            actor_user_id=principal.user_id,
            metadata_changes=metadata_changes,
            file_order=raw.get("file_order"),
            remove_file_ids=raw.get("remove_file_ids"),
            changed_fields=tuple(sorted(raw)),
            request_id=request.state.request_id,
        )
    except SubmissionNotFoundError:
        raise _not_found() from None
    except SubmissionAlreadyDecidedError:
        raise _already_decided() from None
    except InvalidFileSelectionError:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_file_selection", "message": "影像排序或删除列表无效。"},
        ) from None
    # Cleanup markers commit with row deletion. The bounded retry can therefore
    # fail without exposing the file or losing the durable cleanup obligation.
    if removed_records:
        sweep_submission_file_cleanup(
            request.app.state.settings,
            limit=len(removed_records),
            file_ids=tuple(record.file_id for record in removed_records),
        )
    return submission


@router.get("/{submission_id}/files/{file_id}")
def submissions_file(
    submission_id: str,
    file_id: str,
    request: Request,
    _principal: Annotated[Principal, Depends(require_admin)],
):
    settings: Settings = request.app.state.settings
    record = get_admin_submission_file(settings, submission_id, file_id)
    if record is None:
        raise _not_found()
    opened = open_staged_file(settings, submission_id, record)
    if opened is None:
        raise _not_found()
    return StreamingResponse(
        iter_open_file(opened.file),
        media_type=opened.media_type,
        headers={
            "Content-Length": str(opened.file_bytes),
            "Content-Disposition": f'inline; filename="{record.file_id}.{opened.extension}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
        background=BackgroundTask(opened.file.close),
    )


def _decision_error(error: Exception) -> HTTPException:
    if isinstance(error, SubmissionNotFoundError):
        return _not_found()
    return _already_decided()


@router.post("/{submission_id}/request-revision", response_model=AdminSubmissionDetail)
def submissions_request_revision(
    submission_id: str,
    payload: ModerationReasonRequest,
    request: Request,
    principal: Annotated[Principal, Depends(require_admin_csrf)],
) -> AdminSubmissionDetail:
    try:
        return decide_admin_submission_with_reason(
            request.app.state.settings,
            submission_id=submission_id,
            actor_user_id=principal.user_id,
            reason=payload.reason,
            decision="request_revision",
            request_id=request.state.request_id,
        )
    except (SubmissionNotFoundError, SubmissionAlreadyDecidedError) as error:
        raise _decision_error(error) from None


@router.post("/{submission_id}/reject", response_model=AdminSubmissionDetail)
def submissions_reject(
    submission_id: str,
    payload: ModerationReasonRequest,
    request: Request,
    principal: Annotated[Principal, Depends(require_admin_csrf)],
) -> AdminSubmissionDetail:
    try:
        return decide_admin_submission_with_reason(
            request.app.state.settings,
            submission_id=submission_id,
            actor_user_id=principal.user_id,
            reason=payload.reason,
            decision="reject",
            request_id=request.state.request_id,
        )
    except (SubmissionNotFoundError, SubmissionAlreadyDecidedError) as error:
        raise _decision_error(error) from None


_PUBLISH_ERRORS = {
    "existing_work_id_not_allowed": "新作品投稿不能关联已有作品标识。",
    "submission_content_required": "新作品投稿需提供题名或正文。",
    "metadata_not_allowed": "已有作品扫描投稿不能包含新作品元数据。",
    "existing_work_id_required": "需提供已有作品标识。",
    "work_not_found": "未找到要关联的公开作品。",
    "files_required": "已有作品扫描投稿需上传影像。",
}


@router.post("/{submission_id}/publish", response_model=AdminSubmissionDetail)
def submissions_publish(
    submission_id: str,
    request: Request,
    principal: Annotated[Principal, Depends(require_admin_csrf)],
) -> AdminSubmissionDetail:
    try:
        return publish_admin_submission(
            request.app.state.settings,
            submission_id=submission_id,
            actor_user_id=principal.user_id,
            request_id=request.state.request_id,
        )
    except (SubmissionNotFoundError, SubmissionAlreadyDecidedError) as error:
        raise _decision_error(error) from None
    except PublishValidationError as error:
        status_code = 404 if error.code == "work_not_found" else 422
        raise HTTPException(
            status_code=status_code,
            detail={"code": error.code, "message": _PUBLISH_ERRORS[error.code]},
        ) from None
