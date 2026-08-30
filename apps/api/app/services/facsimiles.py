import os
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Protocol


class FacsimilePathRecord(Protocol):
    image_path: str
    file_format: str
    file_bytes: int


@dataclass(frozen=True)
class FacsimileFile:
    path: Path
    extension: str
    media_type: str
    disposition: str
    stat_result: os.stat_result


_FORMAT_RULES = {
    "JPG": (frozenset({".jpg", ".jpeg"}), "image/jpeg", "inline", b"\xff\xd8\xff"),
    "JPEG": (frozenset({".jpg", ".jpeg"}), "image/jpeg", "inline", b"\xff\xd8\xff"),
    "PNG": (frozenset({".png"}), "image/png", "inline", b"\x89PNG\r\n\x1a\n"),
    "JP2": (
        frozenset({".jp2"}),
        "image/jp2",
        "attachment",
        bytes.fromhex("0000000c6a5020200d0a870a"),
    ),
}


def _safe_relative_path(image_path: str) -> PurePosixPath | None:
    if (
        not image_path
        or "\x00" in image_path
        or "\\" in image_path
        or ":" in image_path
        or "%" in image_path
        or image_path.startswith("/")
    ):
        return None
    raw_parts = image_path.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        return None
    relative_path = PurePosixPath(image_path)
    if relative_path.is_absolute():
        return None
    if relative_path.parts and relative_path.parts[0] == "facsimiles":
        relative_path = PurePosixPath(*relative_path.parts[1:])
    if not relative_path.parts:
        return None
    return relative_path


def resolve_facsimile_file(
    record: FacsimilePathRecord, facsimile_root: Path
) -> FacsimileFile | None:
    rules = _FORMAT_RULES.get(record.file_format.upper())
    relative_path = _safe_relative_path(record.image_path)
    if rules is None or relative_path is None:
        return None
    extensions, media_type, disposition, signature = rules
    if relative_path.suffix.casefold() not in extensions:
        return None
    try:
        resolved_root = facsimile_root.resolve(strict=True)
        resolved_path = (resolved_root / Path(*relative_path.parts)).resolve(strict=True)
        resolved_path.relative_to(resolved_root)
        stat_result = resolved_path.stat()
        if not resolved_path.is_file() or stat_result.st_size != record.file_bytes:
            return None
        with resolved_path.open("rb") as file:
            if file.read(len(signature)) != signature:
                return None
    except (OSError, RuntimeError, ValueError):
        return None
    return FacsimileFile(
        path=resolved_path,
        extension=relative_path.suffix.casefold(),
        media_type=media_type,
        disposition=disposition,
        stat_result=stat_result,
    )
