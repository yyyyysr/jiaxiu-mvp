import json
import re
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.api.dependencies.auth import require_admin
from app.schemas.admin import AuditEventPage, AuditEventResponse
from app.services.audit import read_audit_event_page
from app.services.auth import Principal

router = APIRouter(prefix="/admin/audit-events", tags=["admin-audit"])

_ENTITY_ID = re.compile(r"[0-9a-f]{32}")
_MAX_DETAIL_CHARS = 16_384
_MAX_DETAIL_BYTES = 16_384
_MAX_DETAIL_DEPTH = 4
_MAX_DETAIL_ITEMS = 100
_MAX_DETAIL_SCALAR_CHARS = 4_096
_EDIT_FIELDS = frozenset(
    {
        "title",
        "authors",
        "poem_text",
        "genre",
        "historical_period",
        "notes",
        "file_order",
        "remove_file_ids",
    }
)
_EMPTY_DETAIL_ACTIONS = frozenset(
    {
        "password_changed",
        "password_reset",
        "login_succeeded",
        "login_failed",
        "login_rate_limited",
        "logout",
        "submission_resubmitted",
        "revision_requested",
        "submission_rejected",
    }
)
_ACTION_TARGET_TYPES = {
    "user.created": "user",
    "user_created": "user",
    "user_enabled": "user",
    "user_disabled": "user",
    "password_changed": "user",
    "password_reset": "user",
    "login_succeeded": "user",
    "login_failed": "user",
    "login_rate_limited": "user",
    "logout": "user",
    "submission_resubmitted": "submission",
    "submission_edited": "submission",
    "revision_requested": "submission",
    "submission_rejected": "submission",
    "submission_published": "submission",
}
_UNKNOWN_TARGET_ACTIONS = frozenset({"login_failed", "login_rate_limited"})


def _object_detail(raw_detail: str) -> dict[str, object] | None:
    if not isinstance(raw_detail, str) or len(raw_detail) > _MAX_DETAIL_CHARS:
        return None
    try:
        if len(raw_detail.encode("utf-8")) > _MAX_DETAIL_BYTES:
            return None
        value = json.loads(raw_detail)
    except (json.JSONDecodeError, RecursionError, TypeError, UnicodeEncodeError):
        return None
    if not isinstance(value, dict):
        return None
    stack: list[tuple[object, int]] = [(value, 1)]
    item_count = 0
    scalar_chars = 0
    while stack:
        current, depth = stack.pop()
        if depth > _MAX_DETAIL_DEPTH:
            return None
        if isinstance(current, dict):
            item_count += len(current)
            if item_count > _MAX_DETAIL_ITEMS or not all(isinstance(key, str) for key in current):
                return None
            scalar_chars += sum(len(key) for key in current)
            stack.extend((item, depth + 1) for item in current.values())
        elif isinstance(current, list):
            item_count += len(current)
            if item_count > _MAX_DETAIL_ITEMS:
                return None
            stack.extend((item, depth + 1) for item in current)
        elif isinstance(current, str):
            scalar_chars += len(current)
        if scalar_chars > _MAX_DETAIL_SCALAR_CHARS:
            return None
    return value


def _project_target_identity(
    action: str,
    target_type: str,
    target_id: str,
    *,
    user_target_exists: bool,
    submission_target_exists: bool,
) -> tuple[str, str, str, bool]:
    if not all(isinstance(value, str) for value in (action, target_type, target_id)):
        return "unknown", "unknown", "unknown", False
    expected_type = _ACTION_TARGET_TYPES.get(action)
    if expected_type is None:
        return "unknown", "unknown", "unknown", False
    if target_type != expected_type:
        return action, "unknown", "unknown", False
    if target_id == "unknown" and action in _UNKNOWN_TARGET_ACTIONS:
        return action, target_type, "unknown", False
    target_exists = user_target_exists if target_type == "user" else submission_target_exists
    if _ENTITY_ID.fullmatch(target_id) is None or not target_exists:
        return action, target_type, "unknown", False
    return action, target_type, target_id, True


def _project_detail(action: str, raw_detail: str) -> dict[str, object]:
    if action in _EMPTY_DETAIL_ACTIONS:
        return {}
    detail = _object_detail(raw_detail)
    if detail is None:
        return {}
    if action in {"user.created", "user_created"}:
        role = detail.get("role")
        return {"role": role} if role in {"contributor", "admin"} else {}
    if action in {"user_enabled", "user_disabled"}:
        is_active = detail.get("is_active")
        return {"is_active": is_active} if isinstance(is_active, bool) else {}
    if action == "submission_edited":
        projected: dict[str, object] = {}
        changed_fields = detail.get("changed_fields")
        if isinstance(changed_fields, list):
            projected["changed_fields"] = [
                value
                for value in changed_fields
                if isinstance(value, str) and value in _EDIT_FIELDS
            ]
        return projected
    return {}


@router.get("", response_model=AuditEventPage)
def audit_events_list(
    request: Request,
    _principal: Annotated[Principal, Depends(require_admin)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> AuditEventPage:
    rows, total = read_audit_event_page(request.app.state.settings, page=page, page_size=page_size)
    return AuditEventPage(
        page=page,
        page_size=page_size,
        total=total,
        events=[
            AuditEventResponse(
                event_id=row.event_id,
                actor_username=row.actor_username,
                action=identity[0],
                target_type=identity[1],
                target_id=identity[2],
                detail=_project_detail(row.action, row.detail_json) if identity[3] else {},
                request_id=row.public_request_ref_v1 or "legacy-unavailable",
                created_at=row.created_at,
            )
            for row in rows
            for identity in [
                _project_target_identity(
                    row.action,
                    row.target_type,
                    row.target_id,
                    user_target_exists=row.user_target_exists,
                    submission_target_exists=row.submission_target_exists,
                )
            ]
        ],
    )
