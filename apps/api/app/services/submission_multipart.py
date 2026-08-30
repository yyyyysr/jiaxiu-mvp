from collections.abc import AsyncGenerator
from urllib.parse import parse_qsl

from fastapi import Request
from python_multipart.exceptions import MultipartParseError
from starlette.datastructures import FormData
from starlette.formparsers import MultiPartException, MultiPartParser

from app.services.submission_files import MAX_FILE_BYTES, MAX_TOTAL_UPLOAD_BYTES

MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024
MAX_SUBMISSION_REQUEST_BYTES = MAX_TOTAL_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
MAX_FORM_FIELDS = 8
MAX_FORM_PART_BYTES = 400_000
MAX_URLENCODED_BODY_BYTES = 512 * 1024
MAX_MULTIPART_FILES = 10
MAX_MULTIPART_PART_HEADER_BYTES = 8 * 1024


class SubmissionBodyTooLargeError(Exception):
    pass


class SubmissionFilePartTooLargeError(MultiPartException):
    pass


class SubmissionTooManyFilesError(MultiPartException):
    pass


class SubmissionTooManyFieldsError(MultiPartException):
    pass


class StrictSubmissionMultipartParser(MultiPartParser):
    """Starlette parser with a file-part limit enforced before spool writes."""

    def __init__(
        self,
        *args,
        max_file_size: int,
        max_total_file_size: int,
        max_part_header_size: int,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)
        self.max_file_size = max_file_size
        self.max_total_file_size = max_total_file_size
        self.max_part_header_size = max_part_header_size
        self._current_file_bytes = 0
        self._total_file_bytes = 0
        self._current_part_header_bytes = 0

    def on_part_begin(self) -> None:
        super().on_part_begin()
        self._current_file_bytes = 0
        self._current_part_header_bytes = 0

    def _count_header_bytes(self, count: int) -> None:
        self._current_part_header_bytes += count
        if self._current_part_header_bytes > self.max_part_header_size:
            raise MultiPartException("Multipart part headers exceeded the maximum size")

    def on_header_field(self, data: bytes, start: int, end: int) -> None:
        self._count_header_bytes(end - start)
        super().on_header_field(data, start, end)

    def on_header_value(self, data: bytes, start: int, end: int) -> None:
        self._count_header_bytes(end - start)
        super().on_header_value(data, start, end)

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        message_bytes = data[start:end]
        if self._current_part.file is not None:
            self._current_file_bytes += len(message_bytes)
            self._total_file_bytes += len(message_bytes)
            if self._current_file_bytes > self.max_file_size:
                raise SubmissionFilePartTooLargeError("影像文件超过 25MB 上传上限。")
            if self._total_file_bytes > self.max_total_file_size:
                raise SubmissionFilePartTooLargeError("投稿影像总量超过 100MB 上传上限。")
        super().on_part_data(data, start, end)

    def on_headers_finished(self) -> None:
        try:
            super().on_headers_finished()
        except MultiPartException as error:
            message = str(error)
            if message.startswith("Too many files"):
                raise SubmissionTooManyFilesError(message) from None
            if message.startswith("Too many fields"):
                raise SubmissionTooManyFieldsError(message) from None
            raise


async def _bounded_request_stream(
    request: Request, *, limit: int | None = None
) -> AsyncGenerator[bytes, None]:
    resolved_limit = MAX_SUBMISSION_REQUEST_BYTES if limit is None else limit
    raw_content_length = request.headers.get("content-length")
    if raw_content_length:
        try:
            declared_length = int(raw_content_length)
        except ValueError:
            declared_length = 0
        if declared_length > resolved_limit:
            raise SubmissionBodyTooLargeError

    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > resolved_limit:
            raise SubmissionBodyTooLargeError
        yield chunk


async def parse_submission_form(request: Request) -> FormData:
    content_type = request.headers.get("content-type", "").partition(";")[0].strip().casefold()
    if content_type == "application/x-www-form-urlencoded":
        body = bytearray()
        async for chunk in _bounded_request_stream(request, limit=MAX_URLENCODED_BODY_BYTES):
            body.extend(chunk)
        try:
            text = bytes(body).decode("utf-8", errors="strict")
            return FormData(
                parse_qsl(
                    text,
                    keep_blank_values=True,
                    max_num_fields=MAX_FORM_FIELDS,
                    encoding="utf-8",
                    errors="strict",
                )
            )
        except (UnicodeDecodeError, ValueError) as error:
            if "Max number of fields exceeded" in str(error):
                raise SubmissionTooManyFieldsError(str(error)) from None
            raise MultiPartException("Invalid URL-encoded submission form") from None
    if content_type != "multipart/form-data":
        raise MultiPartException("Submission form must be multipart or URL-encoded")
    parser = StrictSubmissionMultipartParser(
        request.headers,
        _bounded_request_stream(request),
        max_files=MAX_MULTIPART_FILES,
        max_fields=MAX_FORM_FIELDS,
        max_part_size=MAX_FORM_PART_BYTES,
        max_file_size=MAX_FILE_BYTES,
        max_total_file_size=MAX_TOTAL_UPLOAD_BYTES,
        max_part_header_size=MAX_MULTIPART_PART_HEADER_BYTES,
    )
    try:
        return await parser.parse()
    except MultipartParseError as error:
        raise MultiPartException("Invalid multipart submission form") from error
