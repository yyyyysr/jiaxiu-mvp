"""Writable, append-only store for reader contributions.

The curated SQLite research database is opened read-only and should not be
mutated by visitor uploads. Contributions (new poems and attached image scans)
therefore live in a separate append-only JSON-lines index plus the files saved
under ``facsimile_root/uploads/`` so the existing secure file resolver can serve
them. Reads scan the whole index; the index is small and append-only.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SUPPORTED_UPLOAD_FORMATS = {"jpg", "jpeg", "png"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")
_JPEG_SIG = b"\xff\xd8\xff"
_PNG_SIG = b"\x89PNG\r\n\x1a\n"


def contributions_dir(facsimile_root: Path) -> Path:
    return facsimile_root.parent / "user_contributions"


def index_file(facsimile_root: Path) -> Path:
    return contributions_dir(facsimile_root) / "index.jsonl"


def read_records(facsimile_root: Path) -> list[dict[str, Any]]:
    index = index_file(facsimile_root)
    if not index.exists():
        return []
    records: list[dict[str, Any]] = []
    with index.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def _append_record(facsimile_root: Path, record: dict[str, Any]) -> None:
    directory = contributions_dir(facsimile_root)
    directory.mkdir(parents=True, exist_ok=True)
    with index_file(facsimile_root).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def sanitize_filename(name: str) -> str:
    cleaned = _SAFE_FILENAME.sub("-", name).strip(".-")
    return cleaned or "scan"


def detect_format(data: bytes) -> str | None:
    if data.startswith(_JPEG_SIG):
        return "jpg"
    if data.startswith(_PNG_SIG):
        return "png"
    return None


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def image_dimensions(data: bytes, file_format: str) -> tuple[int, int]:
    """Read pixel dimensions from the header without Pillow; return (0, 0) if unknown."""
    if file_format == "png" and data.startswith(_PNG_SIG) and len(data) >= 24:
        width = int.from_bytes(data[16:20], "big")
        height = int.from_bytes(data[20:24], "big")
        return width, height
    if file_format in {"jpg", "jpeg"} and data.startswith(_JPEG_SIG):
        index = 2
        length = len(data)
        while index + 9 < length:
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            if marker in {0xD8, 0x01} or 0xD0 <= marker <= 0xD7:
                index += 2
                continue
            # SOF0..SOF15 (excluding DHT/DAC 0xC4/0xCC) carry the frame size.
            if 0xC0 <= marker <= 0xCF and marker not in {0xC4, 0xC8, 0xCC}:
                height = int.from_bytes(data[index + 5 : index + 7], "big")
                width = int.from_bytes(data[index + 7 : index + 9], "big")
                return width, height
            segment_length = int.from_bytes(data[index + 2 : index + 4], "big")
            if segment_length < 2:
                break
            index += 2 + segment_length
    return 0, 0


def slugify_work_id(title: str, existing: set[str]) -> str:
    base = _SAFE_FILENAME.sub("-", title).strip("-").lower()[:60] or "poem"
    candidate = f"user-{base}"
    suffix = 2
    while candidate in existing:
        candidate = f"user-{base}-{suffix}"
        suffix += 1
    return candidate


def list_contribution_facsimiles(facsimile_root: Path, work_id: str) -> list[dict[str, Any]]:
    return [
        record
        for record in read_records(facsimile_root)
        if record.get("kind") == "facsimile" and record.get("work_id") == work_id
    ]


def list_contribution_works(facsimile_root: Path) -> list[dict[str, Any]]:
    return [record for record in read_records(facsimile_root) if record.get("kind") == "work"]


def find_contribution_work(facsimile_root: Path, work_id: str) -> dict[str, Any] | None:
    for record in read_records(facsimile_root):
        if record.get("kind") == "work" and record.get("work_id") == work_id:
            return record
    return None


def find_contribution_facsimile(
    facsimile_root: Path, work_id: str, image_id: str
) -> dict[str, Any] | None:
    for record in read_records(facsimile_root):
        if (
            record.get("kind") == "facsimile"
            and record.get("work_id") == work_id
            and record.get("image_id") == image_id
        ):
            return record
    return None


def save_scan(facsimile_root: Path, data: bytes, original_filename: str) -> dict[str, Any]:
    """Persist an uploaded image and return the facsimile metadata record.

    Returns a ``kind == 'facsimile'`` record ready to be appended (without its
    ``work_id``, which the caller supplies).
    """
    file_format = detect_format(data)
    if file_format is None:
        raise ValueError("仅支持 JPG/PNG 影像扫描。")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("影像文件过大，请控制在上传上限以内。")
    digest = sha256_bytes(data)
    image_id = f"user-{digest[:16]}"
    width, height = image_dimensions(data, file_format)
    extension = ".jpg" if file_format == "jpg" else ".png"
    filename = f"{sanitize_filename(Path(original_filename).stem)}{extension}"
    relative_dir = f"uploads/{image_id}"
    target_dir = facsimile_root / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename
    target_path.write_bytes(data)
    return {
        "kind": "facsimile",
        "image_id": image_id,
        "source_id": None,
        "image_path": f"facsimiles/{relative_dir}/{filename}",
        "scan_page": None,
        "print_page": "",
        "image_role": "user-upload",
        "file_format": file_format,
        "pixel_width": width,
        "pixel_height": height,
        "file_bytes": len(data),
        "sha256": digest,
        "capture_method": "user-upload",
        "quality_note": "用户上传，未重编码。",
        "notes": "",
        "sequence": 100_000,
        "locator": "",
        "association_notes": "用户贡献",
        "created_at": now_iso(),
    }


def register_facsimile(
    facsimile_root: Path, work_id: str, metadata: dict[str, Any], notes: str
) -> dict[str, Any]:
    record = dict(metadata)
    record["work_id"] = work_id
    if notes:
        record["notes"] = notes
    _append_record(facsimile_root, record)
    return record


def register_work(
    facsimile_root: Path,
    *,
    title: str,
    authors: str,
    canonical_text: str,
    genre: str,
    historical_period: str,
    notes: str,
    work_id: str | None,
) -> dict[str, Any]:
    existing = {record["work_id"] for record in read_records(facsimile_root) if record.get("kind") == "work"}
    resolved_id = work_id or slugify_work_id(title, existing)
    record = {
        "kind": "work",
        "work_id": resolved_id,
        "title": title,
        "authors": authors,
        "canonical_text": canonical_text,
        "genre": genre or "诗",
        "historical_period": historical_period or "当代",
        "notes": notes,
        "created_at": now_iso(),
    }
    _append_record(facsimile_root, record)
    return record
