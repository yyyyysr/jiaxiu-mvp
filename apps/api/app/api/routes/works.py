import os
import re
from secrets import token_hex
from typing import Annotated, Literal

import anyio
from fastapi import APIRouter, HTTPException, Query, Request
from starlette.datastructures import MutableHeaders
from starlette.responses import FileResponse, Response
from starlette.types import Receive, Scope, Send

from app.core.config import Settings
from app.db import connect_readonly
from app.repositories.published_contributions import PublishedFile, get_published_work
from app.repositories.works import (
    WorkQuery,
    get_facsimile_file,
    get_work,
    list_facsimiles,
    list_works,
)
from app.schemas.works import Facsimile, WorkDetail, WorkListResponse, WorkSeasonAssociation
from app.services.seasons import ANNOTATION_PATH, load_annotations

router = APIRouter(prefix="/works", tags=["works"])
_UNSAFE_FILENAME_CHARACTERS = re.compile(r"[^A-Za-z0-9._-]+")
ResearchScope = Literal[
    "strict_jiaxiu", "site_origin", "nearby_prebuild", "adjacent_complex", "all"
]
Season = Literal["spring", "summer", "autumn", "winter"]
WorkSort = Literal["relevance", "date_asc", "date_desc", "title_asc", "title_desc"]
Authenticity = Literal["confirmed", "attributed", "disputed"]
Completeness = Literal["complete", "fragment"]


def _safe_filename_part(value: str) -> str:
    return _UNSAFE_FILENAME_CHARACTERS.sub("-", value).strip(".-")[:80] or "unknown"


class SecureFileResponse(FileResponse):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def send_with_security_headers(message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                names = {name.lower() for name, _value in headers}
                for name, value in (
                    (b"accept-ranges", b"bytes"),
                    (b"x-content-type-options", b"nosniff"),
                ):
                    if name not in names:
                        headers.append((name, value))
                message["headers"] = headers
            await send(message)

        await super().__call__(scope, receive, send_with_security_headers)


class SecureOpenedFileResponse(SecureFileResponse):
    def __init__(self, facsimile: PublishedFile, *, filename: str) -> None:
        self.source = facsimile.opened.file
        super().__init__(
            path="",
            media_type=facsimile.opened.media_type,
            filename=filename,
            content_disposition_type="inline",
            stat_result=os.fstat(self.source.fileno()),
            headers={
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "public, max-age=3600",
                "Content-Security-Policy": "default-src 'none'; sandbox",
            },
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.source.close()

    async def _read(self, size: int) -> bytes:
        return await anyio.to_thread.run_sync(self.source.read, size)

    async def _seek(self, offset: int) -> None:
        await anyio.to_thread.run_sync(self.source.seek, offset)

    async def _handle_simple(
        self, send: Send, send_header_only: bool, _send_pathsend: bool
    ) -> None:
        await send(
            {"type": "http.response.start", "status": self.status_code, "headers": self.raw_headers}
        )
        if send_header_only:
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            return
        await self._seek(0)
        more_body = True
        while more_body:
            chunk = await self._read(self.chunk_size)
            more_body = len(chunk) == self.chunk_size
            await send({"type": "http.response.body", "body": chunk, "more_body": more_body})

    async def _handle_single_range(
        self, send: Send, start: int, end: int, file_size: int, send_header_only: bool
    ) -> None:
        headers = MutableHeaders(raw=list(self.raw_headers))
        headers["content-range"] = f"bytes {start}-{end - 1}/{file_size}"
        headers["content-length"] = str(end - start)
        await send({"type": "http.response.start", "status": 206, "headers": headers.raw})
        if send_header_only:
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            return
        await self._seek(start)
        while start < end:
            chunk = await self._read(min(self.chunk_size, end - start))
            if not chunk:
                await send({"type": "http.response.body", "body": b"", "more_body": False})
                return
            start += len(chunk)
            await send(
                {
                    "type": "http.response.body",
                    "body": chunk,
                    "more_body": start < end,
                }
            )

    async def _handle_multiple_ranges(
        self,
        send: Send,
        ranges: list[tuple[int, int]],
        file_size: int,
        send_header_only: bool,
    ) -> None:
        boundary = token_hex(13)
        content_length, header = self.generate_multipart(
            ranges, boundary, file_size, self.headers["content-type"]
        )
        headers = MutableHeaders(raw=list(self.raw_headers))
        headers["content-type"] = f"multipart/byteranges; boundary={boundary}"
        headers["content-length"] = str(content_length)
        await send({"type": "http.response.start", "status": 206, "headers": headers.raw})
        if send_header_only:
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            return
        for start, end in ranges:
            await send(
                {"type": "http.response.body", "body": header(start, end), "more_body": True}
            )
            await self._seek(start)
            while start < end:
                chunk = await self._read(min(self.chunk_size, end - start))
                if not chunk:
                    break
                start += len(chunk)
                await send({"type": "http.response.body", "body": chunk, "more_body": True})
            await send({"type": "http.response.body", "body": b"\r\n", "more_body": True})
        await send(
            {
                "type": "http.response.body",
                "body": f"--{boundary}--".encode("latin-1"),
                "more_body": False,
            }
        )


def _resolve_media_work(
    connection,
    settings: Settings,
    work_id: str,
    include_related: bool,
) -> tuple[WorkDetail | None, bool]:
    application_target = get_published_work(settings, work_id) is not None
    work = get_work(
        connection,
        work_id,
        include_related,
        settings.facsimile_root,
        settings=settings if application_target else None,
    )
    return work, application_target


@router.get("", response_model=WorkListResponse)
def read_works(
    request: Request,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[str | None, Query(max_length=200)] = None,
    author: Annotated[str | None, Query(max_length=200)] = None,
    period: Annotated[str | None, Query(max_length=100)] = None,
    historical_period: str | None = None,
    date_from: Annotated[int | None, Query(ge=0, le=3000)] = None,
    date_to: Annotated[int | None, Query(ge=0, le=3000)] = None,
    genre: str | None = None,
    season: Season | None = None,
    relation_scope: ResearchScope | None = None,
    authenticity: Authenticity | None = None,
    completeness: Completeness | None = None,
    has_facsimile: bool | None = None,
    sort: WorkSort = "date_asc",
    include_related: bool = False,
) -> WorkListResponse:
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_date_range", "message": "起始年代不能晚于结束年代。"},
        )
    if period is not None and historical_period is not None and period != historical_period:
        raise HTTPException(
            status_code=422,
            detail={"code": "conflicting_period", "message": "时期筛选参数相互冲突。"},
        )
    settings: Settings = request.app.state.settings
    season_work_ids = None
    if season is not None:
        season_work_ids = tuple(
            annotation.work_id for annotation in load_annotations(ANNOTATION_PATH)[season]
        )
    query = WorkQuery(
        page=page,
        page_size=page_size,
        q=q,
        author=author,
        historical_period=period or historical_period,
        date_from=date_from,
        date_to=date_to,
        genre=genre,
        season_work_ids=season_work_ids,
        relation_scope=relation_scope,
        authenticity=authenticity,
        completeness=completeness,
        has_facsimile=has_facsimile,
        sort=sort,
        include_related=include_related,
    )
    with connect_readonly(settings) as connection:
        items, total = list_works(connection, query, settings.facsimile_root, settings=settings)
    pages = (total + page_size - 1) // page_size
    return WorkListResponse(items=items, total=total, page=page, page_size=page_size, pages=pages)


@router.get("/{work_id}/facsimiles", response_model=list[Facsimile])
def read_facsimiles(
    request: Request, work_id: str, include_related: bool = False
) -> list[Facsimile]:
    settings: Settings = request.app.state.settings
    with connect_readonly(settings) as connection:
        work, application_target = _resolve_media_work(
            connection, settings, work_id, include_related
        )
        if work is None:
            raise HTTPException(
                status_code=404,
                detail={"code": "work_not_found", "message": "未找到该作品。"},
            )
        return list_facsimiles(
            connection,
            work_id,
            settings.facsimile_root,
            include_related=include_related,
            settings=settings,
            application_target=application_target,
        )


@router.get("/{work_id}/facsimiles/{image_id}/file", response_class=FileResponse)
def read_facsimile_file(
    request: Request,
    work_id: str,
    image_id: str,
    include_related: bool = False,
) -> Response:
    settings: Settings = request.app.state.settings
    with connect_readonly(settings) as connection:
        work, application_target = _resolve_media_work(
            connection, settings, work_id, include_related
        )
        facsimile = (
            get_facsimile_file(
                connection,
                work_id,
                image_id,
                settings.facsimile_root,
                include_related=include_related,
                settings=settings,
                application_target=application_target,
            )
            if work is not None
            else None
        )
    if facsimile is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "facsimile_not_found", "message": "未找到可用的影像文件。"},
        )
    if isinstance(facsimile, PublishedFile):
        filename = (
            f"{_safe_filename_part(work_id)}-{_safe_filename_part(image_id)}"
            f".{facsimile.opened.extension}"
        )
        return SecureOpenedFileResponse(facsimile, filename=filename)
    return SecureFileResponse(
        path=facsimile.path,
        media_type=facsimile.media_type,
        filename=(
            f"{_safe_filename_part(work_id)}-{_safe_filename_part(image_id)}{facsimile.extension}"
        ),
        content_disposition_type=facsimile.disposition,
        stat_result=facsimile.stat_result,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.get("/{work_id}", response_model=WorkDetail)
def read_work(request: Request, work_id: str, include_related: bool = False) -> WorkDetail:
    settings: Settings = request.app.state.settings
    with connect_readonly(settings) as connection:
        work = get_work(
            connection,
            work_id,
            include_related,
            settings.facsimile_root,
            settings=settings,
        )
    if work is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "work_not_found", "message": "未找到该作品。"},
        )
    associations = [
        WorkSeasonAssociation.model_validate(annotation.model_dump(exclude={"work_id"}))
        for annotations in load_annotations(ANNOTATION_PATH).values()
        for annotation in annotations
        if annotation.work_id == work_id
    ]
    return work.model_copy(update={"season_associations": associations})
