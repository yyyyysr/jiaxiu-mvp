from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request

from app.core.config import Settings
from app.db import connect_readonly
from app.repositories.works import search_works
from app.schemas.works import SearchResponse

router = APIRouter(prefix="/search", tags=["search"])

Scope = Literal["strict_jiaxiu", "site_origin", "nearby_prebuild", "adjacent_complex", "all"]


@router.get("", response_model=SearchResponse)
def search(
    request: Request,
    q: Annotated[str, Query(max_length=200)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    scope: Scope = "strict_jiaxiu",
) -> SearchResponse:
    settings: Settings = request.app.state.settings
    with connect_readonly(settings) as connection:
        items = search_works(
            connection,
            q,
            limit,
            scope,
            settings.facsimile_root,
            settings=settings,
        )
    return SearchResponse(items=items)
