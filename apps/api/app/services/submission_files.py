from __future__ import annotations

import hashlib
import os
import re
import stat
import warnings
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO, Protocol
from uuid import uuid4

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

from app.app_db import transaction
from app.core.config import Settings

CHUNK_BYTES = 1024 * 1024
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_TOTAL_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_FILES = 10
_SERVER_ID = re.compile(r"[0-9a-f]{32}")
_STORAGE_NAME = re.compile(r"[0-9a-f]{32}\.(?:jpg|png)")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_JPEG_SIGNATURE = b"\xff\xd8\xff"
_REPARSE_ATTRIBUTE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


class UploadSizeLimitError(ValueError):
    pass


@dataclass(frozen=True)
class StagedFile:
    file_id: str
    storage_name: str
    original_name: str
    file_format: str
    media_type: str
    file_bytes: int
    pixel_width: int
    pixel_height: int
    sha256: str
    sequence: int


@dataclass(frozen=True)
class OpenedStagedFile:
    file: BinaryIO
    extension: str
    media_type: str
    file_bytes: int


class StoredFileIdentity(Protocol):
    file_id: str
    storage_name: str
    file_format: str


class StoredFileRecord(StoredFileIdentity, Protocol):
    media_type: str
    file_bytes: int
    pixel_width: int
    pixel_height: int
    sha256: str


def _server_submission_path(settings: Settings, submission_id: str) -> tuple[Path, Path]:
    if _SERVER_ID.fullmatch(submission_id) is None:
        raise ValueError("投稿标识无效。")
    root = settings.submission_root.resolve()
    return root, root / submission_id


def _is_reparse(stat_result: os.stat_result) -> bool:
    return bool(getattr(stat_result, "st_file_attributes", 0) & _REPARSE_ATTRIBUTE)


if os.name == "nt":
    import ctypes
    import msvcrt
    from ctypes import wintypes

    _FILE_READ_ATTRIBUTES = 0x0080
    _GENERIC_READ = 0x80000000
    _GENERIC_WRITE = 0x40000000
    _FILE_SHARE_READ = 0x00000001
    _CREATE_NEW = 1
    _OPEN_EXISTING = 3
    _FILE_ATTRIBUTE_NORMAL = 0x00000080
    _FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000
    _FILE_FLAG_SEQUENTIAL_SCAN = 0x08000000
    _FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
    _INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

    class _ByHandleFileInformation(ctypes.Structure):
        _fields_ = [
            ("dwFileAttributes", wintypes.DWORD),
            ("ftCreationTime", wintypes.FILETIME),
            ("ftLastAccessTime", wintypes.FILETIME),
            ("ftLastWriteTime", wintypes.FILETIME),
            ("dwVolumeSerialNumber", wintypes.DWORD),
            ("nFileSizeHigh", wintypes.DWORD),
            ("nFileSizeLow", wintypes.DWORD),
            ("nNumberOfLinks", wintypes.DWORD),
            ("nFileIndexHigh", wintypes.DWORD),
            ("nFileIndexLow", wintypes.DWORD),
        ]

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _create_file = _kernel32.CreateFileW
    _create_file.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    _create_file.restype = wintypes.HANDLE
    _get_file_information = _kernel32.GetFileInformationByHandle
    _get_file_information.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(_ByHandleFileInformation),
    ]
    _get_file_information.restype = wintypes.BOOL
    _close_handle = _kernel32.CloseHandle
    _close_handle.argtypes = [wintypes.HANDLE]
    _close_handle.restype = wintypes.BOOL


def _windows_handle_information(handle: int):
    information = _ByHandleFileInformation()
    if not _get_file_information(handle, information):
        raise OSError(ctypes.get_last_error(), "Unable to inspect storage handle")
    inode = (information.nFileIndexHigh << 32) | information.nFileIndexLow
    return information.dwFileAttributes, inode


class _WindowsDirectoryLease:
    def __init__(self, path: Path) -> None:
        before = os.lstat(path)
        if not stat.S_ISDIR(before.st_mode) or _is_reparse(before):
            raise OSError("Submission storage directory is unsafe")
        handle = _create_file(
            str(path),
            _FILE_READ_ATTRIBUTES,
            _FILE_SHARE_READ,
            None,
            _OPEN_EXISTING,
            _FILE_FLAG_BACKUP_SEMANTICS | _FILE_FLAG_OPEN_REPARSE_POINT,
            None,
        )
        if handle == _INVALID_HANDLE_VALUE:
            raise OSError(ctypes.get_last_error(), "Unable to lease storage directory")
        self.path = path
        self.handle = handle
        try:
            attributes, inode = _windows_handle_information(handle)
            if attributes & _REPARSE_ATTRIBUTE or inode != before.st_ino:
                raise OSError("Submission storage directory changed while opening")
            self.inode = inode
            self.assert_bound()
        except BaseException:
            self.close()
            raise

    def assert_bound(self) -> None:
        current = os.lstat(self.path)
        if (
            not stat.S_ISDIR(current.st_mode)
            or _is_reparse(current)
            or current.st_ino != self.inode
        ):
            raise OSError("Submission storage directory identity changed")

    def close(self) -> None:
        if self.handle is not None:
            _close_handle(self.handle)
            self.handle = None


class _SecureSubmissionDirectory:
    def __init__(
        self,
        root: Path,
        path: Path,
        *,
        root_lease=None,
        directory_lease=None,
        root_fd: int | None = None,
        directory_fd: int | None = None,
    ) -> None:
        self.root = root
        self.path = path
        self.root_lease = root_lease
        self.directory_lease = directory_lease
        self.root_fd = root_fd
        self.directory_fd = directory_fd

    def assert_bound(self) -> None:
        if os.name == "nt":
            self.root_lease.assert_bound()
            self.directory_lease.assert_bound()
            return
        root_entry = os.stat(self.path.name, dir_fd=self.root_fd, follow_symlinks=False)
        directory = os.fstat(self.directory_fd)
        if not stat.S_ISDIR(root_entry.st_mode) or (
            root_entry.st_dev,
            root_entry.st_ino,
        ) != (directory.st_dev, directory.st_ino):
            raise OSError("Submission storage directory identity changed")

    def _validate_storage_name(self, storage_name: str) -> None:
        if _STORAGE_NAME.fullmatch(storage_name) is None:
            raise OSError("Submission storage name is unsafe")

    def open_new(self, storage_name: str) -> BinaryIO:
        self._validate_storage_name(storage_name)
        self.assert_bound()
        if os.name == "nt":
            handle = _create_file(
                str(self.path / storage_name),
                _GENERIC_READ | _GENERIC_WRITE,
                _FILE_SHARE_READ,
                None,
                _CREATE_NEW,
                _FILE_ATTRIBUTE_NORMAL,
                None,
            )
            if handle == _INVALID_HANDLE_VALUE:
                raise OSError(ctypes.get_last_error(), "Unable to create staged file")
            try:
                attributes, inode = _windows_handle_information(handle)
                if attributes & _REPARSE_ATTRIBUTE or attributes & stat.FILE_ATTRIBUTE_DIRECTORY:
                    raise OSError("Staged file is not a regular file")
                current = os.lstat(self.path / storage_name)
                if _is_reparse(current) or current.st_ino != inode:
                    raise OSError("Staged file identity changed while opening")
                self.assert_bound()
                descriptor = msvcrt.open_osfhandle(handle, os.O_RDWR | os.O_BINARY)
                handle = None
                return os.fdopen(descriptor, "w+b")
            finally:
                if handle is not None:
                    _close_handle(handle)
        flags = os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW
        descriptor = os.open(storage_name, flags, 0o600, dir_fd=self.directory_fd)
        source = os.fdopen(descriptor, "w+b")
        try:
            self.assert_file_bound(storage_name, source)
        except BaseException:
            source.close()
            raise
        return source

    def open_existing(self, storage_name: str) -> BinaryIO:
        self._validate_storage_name(storage_name)
        self.assert_bound()
        if os.name == "nt":
            path = self.path / storage_name
            before = os.lstat(path)
            if not stat.S_ISREG(before.st_mode) or _is_reparse(before):
                raise OSError("Staged file path is unsafe")
            handle = _create_file(
                str(path),
                _GENERIC_READ,
                _FILE_SHARE_READ,
                None,
                _OPEN_EXISTING,
                _FILE_FLAG_OPEN_REPARSE_POINT | _FILE_FLAG_SEQUENTIAL_SCAN,
                None,
            )
            if handle == _INVALID_HANDLE_VALUE:
                raise OSError(ctypes.get_last_error(), "Unable to open staged file")
            try:
                attributes, inode = _windows_handle_information(handle)
                if attributes & _REPARSE_ATTRIBUTE or attributes & stat.FILE_ATTRIBUTE_DIRECTORY:
                    raise OSError("Staged file is not a regular file")
                current = os.lstat(path)
                if _is_reparse(current) or current.st_ino != inode:
                    raise OSError("Staged file identity changed while opening")
                self.assert_bound()
                descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
                handle = None
                return os.fdopen(descriptor, "rb")
            finally:
                if handle is not None:
                    _close_handle(handle)
        descriptor = os.open(
            storage_name,
            os.O_RDONLY | os.O_NOFOLLOW,
            dir_fd=self.directory_fd,
        )
        source = os.fdopen(descriptor, "rb")
        try:
            self.assert_file_bound(storage_name, source)
        except BaseException:
            source.close()
            raise
        return source

    def assert_file_bound(self, storage_name: str, source: BinaryIO) -> None:
        opened = os.fstat(source.fileno())
        if not stat.S_ISREG(opened.st_mode):
            raise OSError("Staged file is not regular")
        if os.name == "nt":
            current = os.lstat(self.path / storage_name)
        else:
            current = os.stat(storage_name, dir_fd=self.directory_fd, follow_symlinks=False)
        if (
            _is_reparse(current)
            or not stat.S_ISREG(current.st_mode)
            or (
                current.st_dev,
                current.st_ino,
            )
            != (opened.st_dev, opened.st_ino)
        ):
            raise OSError("Staged file identity changed")
        self.assert_bound()

    def close(self) -> None:
        if os.name == "nt":
            if self.directory_lease is not None:
                self.directory_lease.close()
            if self.root_lease is not None:
                self.root_lease.close()
            return
        if self.directory_fd is not None:
            os.close(self.directory_fd)
            self.directory_fd = None
        if self.root_fd is not None:
            os.close(self.root_fd)
            self.root_fd = None


@contextmanager
def _secure_submission_directory(
    settings: Settings, submission_id: str, *, create: bool
) -> Iterator[_SecureSubmissionDirectory]:
    root, path = _server_submission_path(settings, submission_id)
    root.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        root_lease = _WindowsDirectoryLease(root)
        directory_lease = None
        try:
            root_lease.assert_bound()
            if create:
                os.mkdir(path)
            directory_lease = _WindowsDirectoryLease(path)
            access = _SecureSubmissionDirectory(
                root,
                path,
                root_lease=root_lease,
                directory_lease=directory_lease,
            )
            access.assert_bound()
            yield access
        finally:
            if directory_lease is not None:
                directory_lease.close()
            root_lease.close()
        return

    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    root_fd = os.open(root, directory_flags)
    directory_fd = None
    try:
        if create:
            os.mkdir(submission_id, mode=0o700, dir_fd=root_fd)
        directory_fd = os.open(submission_id, directory_flags, dir_fd=root_fd)
        access = _SecureSubmissionDirectory(
            root,
            path,
            root_fd=root_fd,
            directory_fd=directory_fd,
        )
        access.assert_bound()
        yield access
    finally:
        if directory_fd is not None:
            os.close(directory_fd)
        os.close(root_fd)


def remove_staged_submission(settings: Settings, submission_id: str) -> None:
    try:
        with _secure_submission_directory(settings, submission_id, create=False) as access:
            access.assert_bound()
            names = os.listdir(access.path if os.name == "nt" else access.directory_fd)
            for name in names:
                if os.name == "nt":
                    item = access.path / name
                    item_stat = os.lstat(item)
                    if stat.S_ISDIR(item_stat.st_mode) and not _is_reparse(item_stat):
                        return
                    os.unlink(item)
                else:
                    item_stat = os.stat(name, dir_fd=access.directory_fd, follow_symlinks=False)
                    if stat.S_ISDIR(item_stat.st_mode):
                        return
                    os.unlink(name, dir_fd=access.directory_fd)
            access.assert_bound()
            path = access.path
        os.rmdir(path)
    except (OSError, RuntimeError, ValueError):
        return


def staged_file_identity_is_valid(
    submission_id: str, file_id: str, storage_name: str, file_format: str
) -> bool:
    if not all(
        isinstance(value, str) for value in (submission_id, file_id, storage_name, file_format)
    ):
        return False
    return (
        _SERVER_ID.fullmatch(submission_id) is not None
        and _SERVER_ID.fullmatch(file_id) is not None
        and file_format in {"jpg", "png"}
        and storage_name == f"{file_id}.{file_format}"
        and _STORAGE_NAME.fullmatch(storage_name) is not None
    )


def _reserve_staged_file(
    settings: Settings,
    *,
    submission_id: str,
    file_id: str,
    storage_name: str,
    file_format: str,
) -> None:
    if not staged_file_identity_is_valid(submission_id, file_id, storage_name, file_format):
        raise ValueError("Staged file reservation identity is invalid")
    with transaction(settings) as connection:
        connection.execute(
            """
            INSERT INTO submission_file_staging_inventory (
                reservation_id, submission_id, file_id, storage_name,
                file_format, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                uuid4().hex,
                submission_id,
                file_id,
                storage_name,
                file_format,
                datetime.now(UTC).isoformat(),
            ),
        )


def remove_staged_file(settings: Settings, submission_id: str, record: StoredFileIdentity) -> bool:
    """Unlink one unreferenced private file without following links.

    Callers remove the database row in a committed transaction first. A failed
    unlink therefore leaves an inaccessible orphan, while a database rollback
    can never leave a row pointing at a file removed by this function.
    """
    if not staged_file_identity_is_valid(
        submission_id, record.file_id, record.storage_name, record.file_format
    ):
        return False
    try:
        with _secure_submission_directory(settings, submission_id, create=False) as access:
            access.assert_bound()
            if os.name == "nt":
                target = access.path / record.storage_name
                item_stat = os.lstat(target)
                if not stat.S_ISREG(item_stat.st_mode) or _is_reparse(item_stat):
                    return False
                os.unlink(target)
            else:
                item_stat = os.stat(
                    record.storage_name,
                    dir_fd=access.directory_fd,
                    follow_symlinks=False,
                )
                if not stat.S_ISREG(item_stat.st_mode):
                    return False
                os.unlink(record.storage_name, dir_fd=access.directory_fd)
            access.assert_bound()
        return True
    except (OSError, RuntimeError, ValueError):
        return False


def staged_file_is_absent(
    settings: Settings, submission_id: str, record: StoredFileIdentity
) -> bool:
    """Check exact-name absence without following a file or directory link."""
    if not staged_file_identity_is_valid(
        submission_id, record.file_id, record.storage_name, record.file_format
    ):
        return False
    try:
        with _secure_submission_directory(settings, submission_id, create=False) as access:
            access.assert_bound()
            if os.name == "nt":
                os.lstat(access.path / record.storage_name)
            else:
                os.stat(
                    record.storage_name,
                    dir_fd=access.directory_fd,
                    follow_symlinks=False,
                )
            return False
    except FileNotFoundError:
        return True
    except (OSError, RuntimeError, ValueError):
        return False


def _safe_original_name(filename: str | None) -> str:
    leaf = (filename or "scan").replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = "".join(character for character in leaf if character.isprintable()).strip()
    return cleaned[:255] or "scan"


def _declared_format(filename: str) -> str | None:
    suffix = Path(filename).suffix.casefold()
    if suffix == ".png":
        return "png"
    if suffix in {".jpg", ".jpeg"}:
        return "jpg"
    return None


def _signature_format(header: bytes) -> str | None:
    if header.startswith(_PNG_SIGNATURE):
        return "png"
    if header.startswith(_JPEG_SIGNATURE):
        return "jpg"
    return None


def _decode_dimensions(source: BinaryIO, expected_format: str) -> tuple[int, int]:
    expected_pillow_format = "JPEG" if expected_format == "jpg" else "PNG"
    try:
        source.seek(0)
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as image:
                if image.format != expected_pillow_format:
                    raise ValueError("文件扩展名与影像格式不一致。")
                image.load()
                width, height = image.size
        source.seek(0)
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValueError("影像尺寸过大。") from None
    except (OSError, SyntaxError, UnidentifiedImageError):
        raise ValueError("影像文件损坏或无法解码。") from None
    if width <= 0 or height <= 0:
        raise ValueError("影像尺寸无效。")
    return width, height


async def stage_uploads(
    settings: Settings, submission_id: str, files: list[UploadFile]
) -> list[StagedFile]:
    if len(files) > MAX_FILES:
        raise ValueError("每次投稿最多上传 10 个影像文件。")
    staged: list[StagedFile] = []
    total_bytes = 0
    digests: set[str] = set()
    try:
        with _secure_submission_directory(settings, submission_id, create=True) as directory:
            for sequence, upload in enumerate(files, start=1):
                original_name = _safe_original_name(upload.filename)
                declared_format = _declared_format(original_name)
                if declared_format is None:
                    raise ValueError("仅支持 PNG/JPG 影像扫描。")
                file_id = uuid4().hex
                extension = "jpg" if declared_format == "jpg" else "png"
                storage_name = f"{file_id}.{extension}"
                _reserve_staged_file(
                    settings,
                    submission_id=submission_id,
                    file_id=file_id,
                    storage_name=storage_name,
                    file_format=extension,
                )
                digest = hashlib.sha256()
                file_bytes = 0
                header = b""
                with directory.open_new(storage_name) as destination:
                    while True:
                        chunk = await upload.read(CHUNK_BYTES)
                        if not chunk:
                            break
                        file_bytes += len(chunk)
                        total_bytes += len(chunk)
                        if file_bytes > MAX_FILE_BYTES:
                            raise UploadSizeLimitError("单个影像文件不得超过 25MB。")
                        if total_bytes > MAX_TOTAL_UPLOAD_BYTES:
                            raise UploadSizeLimitError("每次投稿影像总量不得超过 100MB。")
                        if len(header) < len(_PNG_SIGNATURE):
                            header += chunk[: len(_PNG_SIGNATURE) - len(header)]
                        digest.update(chunk)
                        destination.write(chunk)
                    destination.flush()
                    if file_bytes == 0:
                        raise ValueError("影像文件不能为空。")
                    actual_format = _signature_format(header)
                    if actual_format is None:
                        raise ValueError("仅支持 PNG/JPG 影像扫描。")
                    if actual_format != declared_format:
                        raise ValueError("文件扩展名与影像格式不一致。")
                    sha256 = digest.hexdigest()
                    if sha256 in digests:
                        raise ValueError("同一投稿不能包含重复影像。")
                    width, height = _decode_dimensions(destination, actual_format)
                    directory.assert_file_bound(storage_name, destination)
                digests.add(sha256)
                staged.append(
                    StagedFile(
                        file_id=file_id,
                        storage_name=storage_name,
                        original_name=original_name,
                        file_format=actual_format,
                        media_type=("image/jpeg" if actual_format == "jpg" else "image/png"),
                        file_bytes=file_bytes,
                        pixel_width=width,
                        pixel_height=height,
                        sha256=sha256,
                        sequence=sequence,
                    )
                )
            directory.assert_bound()
    except BaseException:
        remove_staged_submission(settings, submission_id)
        raise
    return staged


def open_staged_file(
    settings: Settings, submission_id: str, record: StoredFileRecord
) -> OpenedStagedFile | None:
    extension = "jpg" if record.file_format == "jpg" else "png"
    if record.storage_name != f"{record.file_id}.{extension}":
        return None
    source: BinaryIO | None = None
    try:
        with _secure_submission_directory(settings, submission_id, create=False) as directory:
            source = directory.open_existing(record.storage_name)
            opened = os.fstat(source.fileno())
            if opened.st_size != record.file_bytes:
                raise OSError("Staged file size changed")
            digest = hashlib.sha256()
            header = b""
            while chunk := source.read(CHUNK_BYTES):
                if len(header) < len(_PNG_SIGNATURE):
                    header += chunk[: len(_PNG_SIGNATURE) - len(header)]
                digest.update(chunk)
            if (
                _signature_format(header) != record.file_format
                or digest.hexdigest() != record.sha256
            ):
                raise OSError("Staged file content changed")
            width, height = _decode_dimensions(source, record.file_format)
            if (width, height) != (record.pixel_width, record.pixel_height):
                raise OSError("Staged file dimensions changed")
            directory.assert_file_bound(record.storage_name, source)
            source.seek(0)
            return OpenedStagedFile(
                file=source,
                extension=extension,
                media_type="image/jpeg" if record.file_format == "jpg" else "image/png",
                file_bytes=record.file_bytes,
            )
    except (OSError, RuntimeError, ValueError):
        if source is not None:
            source.close()
        return None


def iter_open_file(source: BinaryIO, *, chunk_bytes: int = CHUNK_BYTES) -> Iterator[bytes]:
    try:
        while chunk := source.read(chunk_bytes):
            yield chunk
    finally:
        source.close()
