import sqlite3
from dataclasses import dataclass, replace
from pathlib import Path
from urllib.parse import quote

from app.core.config import Settings
from app.repositories.published_contributions import (
    PublishedFacsimile,
    PublishedFile,
    PublishedWork,
    get_published_work,
    list_published_facsimile_ids,
    list_published_works,
    resolve_published_facsimiles,
    resolve_published_file,
)
from app.schemas.works import (
    AuthorDetail,
    Facsimile,
    MatchField,
    ResearchStatus,
    SearchHit,
    Source,
    TextVariant,
    WorkDetail,
    WorkSummary,
)
from app.services.contributions import (
    find_contribution_facsimile,
    find_contribution_work,
    list_contribution_facsimiles,
    list_contribution_works,
    read_records,
)
from app.services.facsimiles import FacsimileFile, resolve_facsimile_file

_VALID_SCOPES = frozenset(
    {"strict_jiaxiu", "site_origin", "nearby_prebuild", "adjacent_complex", "all"}
)
_VALID_SORTS = frozenset({"relevance", "date_asc", "date_desc", "title_asc", "title_desc"})
_SEARCH_FIELDS: tuple[MatchField, ...] = (
    "title",
    "alternate_titles",
    "canonical_text",
    "authors",
    "notes",
)


@dataclass(frozen=True)
class WorkQuery:
    page: int = 1
    page_size: int = 20
    q: str | None = None
    author: str | None = None
    historical_period: str | None = None
    date_from: int | None = None
    date_to: int | None = None
    genre: str | None = None
    season_work_ids: tuple[str, ...] | None = None
    relation_scope: str | None = None
    authenticity: str | None = None
    completeness: str | None = None
    has_facsimile: bool | None = None
    sort: str = "date_asc"
    include_related: bool = False


@dataclass(frozen=True)
class FacsimileRecord:
    image_id: str
    source_id: str | None
    image_path: str
    scan_page: int | None
    print_page: str
    image_role: str
    file_format: str
    pixel_width: int
    pixel_height: int
    file_bytes: int
    sha256: str
    capture_method: str
    quality_note: str
    notes: str
    sequence: int
    locator: str
    association_notes: str


def _scope_clause(include_related: bool) -> tuple[str, list[object]]:
    if include_related:
        return "1 = 1", []
    return "relation_scope = ?", ["strict_jiaxiu"]


def _research_status(row: sqlite3.Row) -> ResearchStatus:
    return ResearchStatus(
        authenticity_status=row["authenticity_status"],
        completeness=row["completeness"],
        transcription_status=row["transcription_status"],
        date_certainty=row["date_certainty"],
        relation_scope=row["relation_scope"],
    )


def _search_tokens(query: str) -> tuple[str, ...]:
    return tuple(part for part in query.split() if part)


def _like_pattern(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _centered_excerpt(value: str, tokens: tuple[str, ...], limit: int = 240) -> str:
    if len(value) <= limit:
        return value
    folded = value.casefold()
    positions = [folded.find(token.casefold()) for token in tokens]
    positions = [position for position in positions if position >= 0]
    if not positions:
        return value[:limit]
    start = max(0, min(positions) - limit // 3)
    start = min(start, len(value) - limit)
    return value[start : start + limit]


def _search_details(row: sqlite3.Row, tokens: tuple[str, ...]) -> dict[str, object]:
    matching_fields = [
        field
        for field in _SEARCH_FIELDS
        if any(token.casefold() in (row[field] or "").casefold() for token in tokens)
    ]
    if not matching_fields:
        matching_fields = ["notes"]

    for candidate in ("title", "alternate_titles", "canonical_text", "authors", "notes"):
        if candidate in matching_fields:
            match_field: MatchField = candidate
            break
    excerpt = _centered_excerpt(row[match_field] or "", tokens)
    if match_field in {"title", "alternate_titles"}:
        match_type = "title"
    elif match_field == "canonical_text":
        match_type = "text"
    else:
        match_type = "metadata"

    canonical_excerpt = None
    if "canonical_text" in matching_fields:
        canonical_excerpt = _centered_excerpt(row["canonical_text"], tokens)
    metadata_field = next(
        (field for field in ("authors", "notes") if field in matching_fields), None
    )
    metadata_evidence = (
        _centered_excerpt(row[metadata_field], tokens) if metadata_field is not None else None
    )
    return {
        "match_type": match_type,
        "match_field": match_field,
        "match_fields": matching_fields,
        "excerpt": excerpt,
        "canonical_excerpt": canonical_excerpt,
        "metadata_field": metadata_field,
        "metadata_evidence": metadata_evidence,
    }


def _summary(row: sqlite3.Row, tokens: tuple[str, ...] = ()) -> WorkSummary:
    search_details = _search_details(row, tokens) if tokens else {}
    return WorkSummary(
        work_id=row["work_id"],
        title=row["title"],
        alternate_titles=row["alternate_titles"],
        genre=row["genre"],
        historical_period=row["historical_period"],
        era=row["era"],
        date_original=row["date_original"],
        year_start=row["year_start"],
        year_end=row["year_end"],
        authors=row["authors"],
        facsimile_count=row["facsimile_count"],
        research_status=_research_status(row),
        **{
            key: value
            for key, value in search_details.items()
            if key in {"match_type", "match_field", "excerpt"}
        },
    )


def _query_scope_clause(query: WorkQuery) -> tuple[str, list[object]]:
    if query.relation_scope is not None:
        if query.relation_scope not in _VALID_SCOPES:
            raise ValueError("Unknown research scope.")
        if query.relation_scope == "all":
            return "1 = 1", []
        return "w.relation_scope = ?", [query.relation_scope]
    if query.include_related:
        return "1 = 1", []
    return "w.relation_scope = ?", ["strict_jiaxiu"]


def _search_filter(query: str) -> tuple[list[str], list[object], tuple[str, ...]]:
    tokens = _search_tokens(query.strip())
    if not tokens:
        return ["0 = 1"], [], ()
    clauses: list[str] = []
    parameters: list[object] = []
    fts_tokens = [token for token in tokens if len(token) >= 3]
    if fts_tokens:
        expression = " AND ".join(
            f'"{token.replace(chr(34), chr(34) * 2)}"' for token in fts_tokens
        )
        clauses.append("works_fts MATCH ?")
        parameters.append(expression)
    for token in (token for token in tokens if len(token) < 3):
        clauses.append(
            "(" + " OR ".join(f"w.{field} LIKE ? ESCAPE '\\'" for field in _SEARCH_FIELDS) + ")"
        )
        parameters.extend([_like_pattern(token)] * len(_SEARCH_FIELDS))
    return clauses, parameters, tokens


def _work_filters(query: WorkQuery) -> tuple[list[str], list[object], tuple[str, ...]]:
    scope_clause, parameters = _query_scope_clause(query)
    clauses = [scope_clause]
    tokens: tuple[str, ...] = ()
    if query.q is not None:
        search_clauses, search_parameters, tokens = _search_filter(query.q)
        clauses.extend(search_clauses)
        parameters.extend(search_parameters)
    for value, column in (
        (query.historical_period, "historical_period"),
        (query.genre, "genre"),
        (query.authenticity, "authenticity_status"),
        (query.completeness, "completeness"),
    ):
        if value is not None:
            clauses.append(f"w.{column} = ?")
            parameters.append(value)
    if query.author is not None:
        clauses.append("w.authors LIKE ? ESCAPE '\\'")
        parameters.append(_like_pattern(query.author))
    if query.date_from is not None:
        clauses.append("w.year_end IS NOT NULL AND w.year_end >= ?")
        parameters.append(query.date_from)
    if query.date_to is not None:
        clauses.append("w.year_start IS NOT NULL AND w.year_start <= ?")
        parameters.append(query.date_to)
    if query.season_work_ids is not None:
        if query.season_work_ids:
            placeholders = ", ".join("?" for _ in query.season_work_ids)
            clauses.append(f"w.work_id IN ({placeholders})")
            parameters.extend(query.season_work_ids)
        else:
            clauses.append("0 = 1")
    if query.has_facsimile is not None:
        clauses.append("w.facsimile_count > 0" if query.has_facsimile else "w.facsimile_count = 0")
    return clauses, parameters, tokens


def _work_order(query: WorkQuery, has_search: bool) -> str:
    if query.sort not in _VALID_SORTS:
        raise ValueError("Unknown work sort.")
    if query.sort == "relevance" and has_search:
        return "bm25(works_fts), w.title, w.work_id"
    if query.sort == "date_desc" or query.sort == "relevance":
        return "w.year_start IS NULL, w.year_start DESC, w.year_end DESC, w.title, w.work_id"
    if query.sort == "title_asc":
        return "w.title COLLATE NOCASE, w.work_id"
    if query.sort == "title_desc":
        return "w.title COLLATE NOCASE DESC, w.work_id"
    return "w.year_start IS NULL, w.year_start, w.year_end, w.title, w.work_id"


def list_works(
    connection: sqlite3.Connection,
    query: WorkQuery,
    facsimile_root: Path | None = None,
    settings: Settings | None = None,
) -> tuple[list[WorkSummary], int]:
    if facsimile_root is not None:
        items = _combined_work_summaries(connection, query, facsimile_root, settings)
        total = len(items)
        offset = (query.page - 1) * query.page_size
        return items[offset : offset + query.page_size], total

    clauses, parameters, tokens = _work_filters(query)
    where_clause = " AND ".join(clauses)
    source_clause = (
        "works_fts JOIN v_works_full AS w USING (work_id)"
        if query.q is not None
        else "v_works_full AS w"
    )
    total = connection.execute(
        f"SELECT count(*) FROM {source_clause} WHERE {where_clause}", parameters
    ).fetchone()[0]
    offset = (query.page - 1) * query.page_size
    order_clause = _work_order(query, bool(tokens))
    rows = connection.execute(
        f"""
        SELECT w.* FROM {source_clause}
        WHERE {where_clause}
        ORDER BY {order_clause}
        LIMIT ? OFFSET ?
        """,
        [*parameters, query.page_size, offset],
    ).fetchall()
    return [_summary(row, tokens) for row in rows], total


def count_works_with_facsimiles(connection: sqlite3.Connection) -> int:
    return connection.execute("SELECT count(DISTINCT work_id) FROM work_facsimiles").fetchone()[0]


def _sources(connection: sqlite3.Connection, work_id: str) -> list[Source]:
    rows = connection.execute(
        """
        SELECT s.source_id, s.title, s.source_type, s.author_editor, s.compilation_date,
               s.publication_date, s.publication_year, s.publisher, s.volume, s.pages, s.url,
               s.access_date, s.archive_path, s.reliability, s.language, s.bibliographic_note,
               s.notes AS source_notes, ws.role, ws.locator, ws.is_primary, ws.evidence_note
        FROM work_sources AS ws
        JOIN sources AS s USING (source_id)
        WHERE ws.work_id = ?
        ORDER BY ws.is_primary DESC, ws.work_source_id
        """,
        (work_id,),
    ).fetchall()
    sources = []
    for row in rows:
        source_data = dict(row)
        source_data["is_primary"] = bool(row["is_primary"])
        sources.append(Source(**source_data))
    return sources


def _authors(connection: sqlite3.Connection, work_id: str) -> list[AuthorDetail]:
    rows = connection.execute(
        """
        SELECT a.author_id, a.name, a.name_traditional, a.courtesy_name, a.art_name,
               a.other_names, a.dynasty, a.birth_year, a.death_year, a.biography,
               a.notes, wa.role, wa.position, wa.certainty, wa.attribution_note
        FROM work_authors AS wa
        JOIN authors AS a USING (author_id)
        WHERE wa.work_id = ?
        ORDER BY wa.position, a.name, a.author_id
        """,
        (work_id,),
    ).fetchall()
    return [AuthorDetail(**dict(row)) for row in rows]


def _text_variants(connection: sqlite3.Connection, work_id: str) -> list[TextVariant]:
    rows = connection.execute(
        """
        SELECT variant_id, label, variant_type, full_text, text_script,
               transcription_status, completeness, source_id, locator,
               is_canonical, notes
        FROM text_variants
        WHERE work_id = ?
        ORDER BY is_canonical DESC, variant_id
        """,
        (work_id,),
    ).fetchall()
    variants = []
    for row in rows:
        payload = dict(row)
        payload["is_canonical"] = bool(row["is_canonical"])
        variants.append(TextVariant(**payload))
    return variants


def get_work(
    connection: sqlite3.Connection,
    work_id: str,
    include_related: bool = False,
    facsimile_root: Path | None = None,
    settings: Settings | None = None,
) -> WorkDetail | None:
    if settings is not None:
        published = get_published_work(settings, work_id)
        if published is not None:
            detail = _published_work_detail(published)
            if facsimile_root is not None:
                detail = detail.model_copy(
                    update={
                        "facsimile_count": _combined_facsimile_count(
                            connection, work_id, facsimile_root, settings
                        )
                    }
                )
            return detail
    scope_clause, scope_parameters = _scope_clause(include_related)
    row = connection.execute(
        f"SELECT * FROM v_works_full WHERE work_id = ? AND {scope_clause}",
        [work_id, *scope_parameters],
    ).fetchone()
    if row is None:
        if facsimile_root is None:
            return None
        contribution = find_contribution_work(facsimile_root, work_id)
        if contribution is None:
            return None
        detail = _contribution_work_detail(contribution, facsimile_root)
        return detail.model_copy(
            update={
                "facsimile_count": _combined_facsimile_count(
                    connection, work_id, facsimile_root, settings
                )
            }
        )
    detail = WorkDetail(
        **_summary(row).model_dump(),
        author_roles=row["author_roles"],
        canonical_text=row["canonical_text"],
        text_script=row["text_script"],
        first_publication_date=row["first_publication_date"],
        first_publication_year=row["first_publication_year"],
        inscription_number=row["inscription_number"],
        location_context=row["location_context"],
        lineation_note=row["lineation_note"],
        notes=row["notes"],
        sources=_sources(connection, work_id),
        authors_detail=_authors(connection, work_id),
        text_variants=_text_variants(connection, work_id),
    )
    if facsimile_root is not None:
        detail = detail.model_copy(
            update={
                "facsimile_count": _combined_facsimile_count(
                    connection, work_id, facsimile_root, settings
                )
            }
        )
    return detail


def get_work_summary(
    connection: sqlite3.Connection,
    work_id: str,
    include_related: bool = False,
    facsimile_root: Path | None = None,
    settings: Settings | None = None,
) -> WorkSummary | None:
    if settings is not None:
        published = get_published_work(settings, work_id)
        if published is not None:
            summary = _published_work_summary(published)
            if facsimile_root is not None:
                summary = summary.model_copy(
                    update={
                        "facsimile_count": _combined_facsimile_count(
                            connection, work_id, facsimile_root, settings
                        )
                    }
                )
            return summary
    scope_clause, scope_parameters = _scope_clause(include_related)
    row = connection.execute(
        f"SELECT * FROM v_works_full WHERE work_id = ? AND {scope_clause}",
        [work_id, *scope_parameters],
    ).fetchone()
    if row is None:
        if facsimile_root is None:
            return None
        contribution = find_contribution_work(facsimile_root, work_id)
        if contribution is None:
            return None
        summary = _contribution_work_summary(contribution, facsimile_root)
        return summary.model_copy(
            update={
                "facsimile_count": _combined_facsimile_count(
                    connection, work_id, facsimile_root, settings
                )
            }
        )
    summary = _summary(row)
    if facsimile_root is not None:
        summary = summary.model_copy(
            update={
                "facsimile_count": _combined_facsimile_count(
                    connection, work_id, facsimile_root, settings
                )
            }
        )
    return summary


def _contribution_facsimile_record(record: dict[str, object]) -> FacsimileRecord:
    return FacsimileRecord(
        image_id=str(record["image_id"]),
        source_id=record.get("source_id") if record.get("source_id") is not None else None,
        image_path=str(record["image_path"]),
        scan_page=record.get("scan_page") if record.get("scan_page") is not None else None,
        print_page=str(record.get("print_page", "")),
        image_role=str(record.get("image_role", "user-upload")),
        file_format=str(record.get("file_format", "")),
        pixel_width=int(record.get("pixel_width", 0) or 0),
        pixel_height=int(record.get("pixel_height", 0) or 0),
        file_bytes=int(record.get("file_bytes", 0) or 0),
        sha256=str(record.get("sha256", "")),
        capture_method=str(record.get("capture_method", "user-upload")),
        quality_note=str(record.get("quality_note", "")),
        notes=str(record.get("notes", "")),
        sequence=int(record.get("sequence", 100_000) or 100_000),
        locator=str(record.get("locator", "")),
        association_notes=str(record.get("association_notes", "")),
    )


def _contribution_work_summary(record: dict[str, object], facsimile_root: Path) -> WorkSummary:
    work_id = str(record["work_id"])
    return WorkSummary(
        work_id=work_id,
        title=str(record.get("title", "未题名")),
        alternate_titles="",
        genre=str(record.get("genre", "诗")),
        historical_period=str(record.get("historical_period", "当代")),
        era="",
        date_original="",
        year_start=None,
        year_end=None,
        authors=str(record.get("authors", "")),
        facsimile_count=len(list_contribution_facsimiles(facsimile_root, work_id)),
        research_status=ResearchStatus(
            authenticity_status="attributed",
            completeness="complete",
            transcription_status="unreviewed",
            date_certainty="unspecified",
            relation_scope="strict_jiaxiu",
        ),
    )


def _contribution_work_detail(record: dict[str, object], facsimile_root: Path) -> WorkDetail:
    summary = _contribution_work_summary(record, facsimile_root)
    return WorkDetail(
        **summary.model_dump(),
        author_roles="作者" if record.get("authors") else "作者待考",
        canonical_text=str(record.get("canonical_text", "")),
        text_script="简体",
        first_publication_date="",
        first_publication_year=None,
        inscription_number="",
        location_context="用户贡献的影像与题咏",
        lineation_note="",
        notes=str(record.get("notes", "")),
        sources=[],
        authors_detail=[],
        text_variants=[],
        season_associations=[],
    )


def _published_work_summary(record: PublishedWork, tokens: tuple[str, ...] = ()) -> WorkSummary:
    searchable = {
        "title": record.title,
        "alternate_titles": "",
        "canonical_text": record.canonical_text,
        "authors": record.authors,
        "notes": record.notes,
    }
    search_details = _search_details(searchable, tokens) if tokens else {}
    return WorkSummary(
        work_id=record.work_id,
        title=record.title or "未题名",
        alternate_titles="",
        genre=record.genre or "诗",
        historical_period=record.historical_period or "当代",
        era="",
        date_original=record.submitted_at,
        year_start=None,
        year_end=None,
        authors=record.authors,
        facsimile_count=record.facsimile_count,
        research_status=ResearchStatus(
            authenticity_status="user-contribution",
            completeness="complete" if record.canonical_text.strip() else "image-only",
            transcription_status="admin-reviewed-contribution",
            date_certainty="submitted",
            relation_scope="strict_jiaxiu",
        ),
        **{
            key: value
            for key, value in search_details.items()
            if key in {"match_type", "match_field", "excerpt"}
        },
    )


def _published_work_detail(record: PublishedWork) -> WorkDetail:
    summary = _published_work_summary(record)
    return WorkDetail(
        **summary.model_dump(),
        author_roles="作者" if record.authors else "作者待考",
        canonical_text=record.canonical_text,
        text_script="简体",
        first_publication_date=record.published_at,
        first_publication_year=None,
        inscription_number="",
        location_context="经管理员审核发布的读者投稿",
        lineation_note="",
        notes=record.notes,
        sources=[],
        authors_detail=[],
        text_variants=[],
        season_associations=[],
    )


def _logical_work_matches(
    query: WorkQuery,
    summary: WorkSummary,
    *,
    canonical_text: str,
    notes: str,
) -> tuple[bool, WorkSummary]:
    if query.relation_scope is not None:
        if query.relation_scope not in _VALID_SCOPES:
            raise ValueError("Unknown research scope.")
        if query.relation_scope != "all" and summary.relation_scope != query.relation_scope:
            return False, summary
    elif not query.include_related and summary.relation_scope != "strict_jiaxiu":
        return False, summary
    if query.historical_period is not None and summary.historical_period != query.historical_period:
        return False, summary
    if query.genre is not None and summary.genre != query.genre:
        return False, summary
    if (
        query.authenticity is not None
        and summary.research_status.authenticity_status != query.authenticity
    ):
        return False, summary
    if (
        query.completeness is not None
        and summary.research_status.completeness != query.completeness
    ):
        return False, summary
    if query.author is not None and query.author.casefold() not in summary.authors.casefold():
        return False, summary
    if query.date_from is not None and (
        summary.year_end is None or summary.year_end < query.date_from
    ):
        return False, summary
    if query.date_to is not None and (
        summary.year_start is None or summary.year_start > query.date_to
    ):
        return False, summary
    if query.season_work_ids is not None and summary.work_id not in query.season_work_ids:
        return False, summary
    if query.has_facsimile is not None and (summary.facsimile_count > 0) != query.has_facsimile:
        return False, summary
    if query.q is not None:
        tokens = _search_tokens(query.q.strip())
        if not tokens:
            return False, summary
        searchable = {
            "title": summary.title,
            "alternate_titles": summary.alternate_titles,
            "canonical_text": canonical_text,
            "authors": summary.authors,
            "notes": notes,
        }
        if not all(
            any(
                token.casefold() in (searchable[field] or "").casefold() for field in _SEARCH_FIELDS
            )
            for token in tokens
        ):
            return False, summary
        details = _search_details(searchable, tokens)
        summary = summary.model_copy(
            update={
                key: value
                for key, value in details.items()
                if key in {"match_type", "match_field", "excerpt"}
            }
        )
    return True, summary


def _facsimile_ids_by_work(
    connection: sqlite3.Connection,
    facsimile_root: Path,
    settings: Settings | None,
) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for row in connection.execute(
        "SELECT work_id, image_id FROM work_facsimiles ORDER BY work_id, sequence, image_id"
    ).fetchall():
        result.setdefault(row["work_id"], set()).add(row["image_id"])
    application = list_published_facsimile_ids(settings) if settings is not None else {}
    for record in read_records(facsimile_root):
        if record.get("kind") != "facsimile":
            continue
        work_id = str(record.get("work_id", ""))
        image_id = str(record.get("image_id", ""))
        if work_id and image_id and image_id not in application.get(work_id, set()):
            result.setdefault(work_id, set()).add(image_id)
    for work_id, image_ids in application.items():
        result.setdefault(work_id, set()).update(image_ids)
    return result


def _combined_facsimile_count(
    connection: sqlite3.Connection,
    work_id: str,
    facsimile_root: Path,
    settings: Settings | None,
) -> int:
    return len(_facsimile_ids_by_work(connection, facsimile_root, settings).get(work_id, set()))


def _sort_combined_works(
    items: list[WorkSummary], query: WorkQuery, relevance_order: dict[str, int]
) -> None:
    if query.sort not in _VALID_SORTS:
        raise ValueError("Unknown work sort.")
    if query.sort == "relevance" and query.q is not None:
        items.sort(
            key=lambda item: (
                relevance_order.get(item.work_id, len(relevance_order)),
                item.title.casefold(),
                item.work_id,
            )
        )
    elif query.sort in {"date_desc", "relevance"}:
        items.sort(
            key=lambda item: (
                item.year_start is None,
                -(item.year_start or 0),
                -(item.year_end or 0),
                item.title.casefold(),
                item.work_id,
            )
        )
    elif query.sort == "title_asc":
        items.sort(key=lambda item: (item.title.casefold(), item.work_id))
    elif query.sort == "title_desc":
        items.sort(key=lambda item: item.work_id)
        items.sort(key=lambda item: item.title.casefold(), reverse=True)
    else:
        items.sort(
            key=lambda item: (
                item.year_start is None,
                item.year_start or 0,
                item.year_end or 0,
                item.title.casefold(),
                item.work_id,
            )
        )


def _combined_work_summaries(
    connection: sqlite3.Connection,
    query: WorkQuery,
    facsimile_root: Path,
    settings: Settings | None,
) -> list[WorkSummary]:
    curated_query = replace(query, page=1, page_size=100, has_facsimile=None)
    clauses, parameters, tokens = _work_filters(curated_query)
    source_clause = (
        "works_fts JOIN v_works_full AS w USING (work_id)"
        if curated_query.q is not None
        else "v_works_full AS w"
    )
    curated_rows = connection.execute(
        f"""
        SELECT w.* FROM {source_clause}
        WHERE {" AND ".join(clauses)}
        ORDER BY {_work_order(curated_query, bool(tokens))}
        """,
        parameters,
    ).fetchall()
    facsimile_ids = _facsimile_ids_by_work(connection, facsimile_root, settings)
    curated = []
    for row in curated_rows:
        summary = _summary(row, tokens).model_copy(
            update={"facsimile_count": len(facsimile_ids.get(row["work_id"], set()))}
        )
        if query.has_facsimile is None or (summary.facsimile_count > 0) == query.has_facsimile:
            curated.append(summary)

    published_records = list_published_works(settings) if settings is not None else []
    published_ids = {record.work_id for record in published_records}
    curated_ids = {
        row["work_id"] for row in connection.execute("SELECT work_id FROM works").fetchall()
    }
    combined: dict[str, WorkSummary] = {
        item.work_id: item for item in curated if item.work_id not in published_ids
    }
    for record in list_contribution_works(facsimile_root):
        work_id = str(record.get("work_id", ""))
        if not work_id or work_id in combined or work_id in curated_ids or work_id in published_ids:
            continue
        summary = _contribution_work_summary(record, facsimile_root).model_copy(
            update={"facsimile_count": len(facsimile_ids.get(work_id, set()))}
        )
        matched, summary = _logical_work_matches(
            query,
            summary,
            canonical_text=str(record.get("canonical_text", "")),
            notes=str(record.get("notes", "")),
        )
        if matched:
            combined[work_id] = summary
    for record in published_records:
        summary = _published_work_summary(record).model_copy(
            update={"facsimile_count": len(facsimile_ids.get(record.work_id, set()))}
        )
        matched, summary = _logical_work_matches(
            query,
            summary,
            canonical_text=record.canonical_text,
            notes=record.notes,
        )
        if matched:
            combined[record.work_id] = summary

    relevance_order = {row["work_id"]: index for index, row in enumerate(curated_rows)}
    next_rank = len(relevance_order)
    for work_id in sorted(set(combined) - set(relevance_order)):
        relevance_order[work_id] = next_rank
        next_rank += 1
    items = list(combined.values())
    _sort_combined_works(items, query, relevance_order)
    return items


def _public_facsimile(
    record: FacsimileRecord,
    facsimile_root: Path,
    work_id: str,
    include_related: bool,
) -> Facsimile:
    deployed = resolve_facsimile_file(record, facsimile_root) is not None
    public_url = None
    if deployed:
        public_url = (
            f"/api/v1/works/{quote(work_id, safe='')}/facsimiles/"
            f"{quote(record.image_id, safe='')}/file"
        )
        if include_related:
            public_url += "?include_related=true"
    public_data = dict(record.__dict__)
    public_data.pop("image_path")
    return Facsimile(**public_data, deployed=deployed, public_url=public_url)


def _published_public_facsimile(
    record: PublishedFacsimile, work_id: str, include_related: bool
) -> Facsimile:
    public_url = None
    if record.deployed:
        public_url = (
            f"/api/v1/works/{quote(work_id, safe='')}/facsimiles/"
            f"{quote(record.image_id, safe='')}/file"
        )
        if include_related:
            public_url += "?include_related=true"
    return Facsimile(
        image_id=record.image_id,
        source_id=None,
        public_url=public_url,
        scan_page=None,
        print_page="",
        image_role="user-upload",
        file_format=record.file_format,
        pixel_width=record.pixel_width,
        pixel_height=record.pixel_height,
        file_bytes=record.file_bytes,
        sha256=record.sha256,
        capture_method="user-upload",
        quality_note="管理员审核发布的读者投稿影像。",
        notes=record.notes,
        sequence=record.sequence,
        locator=record.original_name,
        association_notes="读者投稿，经管理员审核发布",
        deployed=record.deployed,
    )


def list_facsimiles(
    connection: sqlite3.Connection,
    work_id: str,
    facsimile_root: Path,
    include_related: bool = False,
    settings: Settings | None = None,
    application_target: bool = False,
) -> list[Facsimile]:
    rows = connection.execute(
        """
        SELECT fi.image_id, fi.source_id, fi.image_path, fi.scan_page, fi.print_page, fi.image_role,
               fi.file_format, fi.pixel_width, fi.pixel_height, fi.file_bytes, fi.sha256,
               fi.capture_method, fi.quality_note, fi.notes, wf.sequence, wf.locator,
               wf.notes AS association_notes
        FROM work_facsimiles AS wf
        JOIN facsimile_images AS fi USING (image_id)
        WHERE wf.work_id = ?
        ORDER BY wf.sequence, fi.scan_page, fi.image_path
        """,
        (work_id,),
    ).fetchall()
    facsimiles: dict[str, Facsimile] = {
        row["image_id"]: _public_facsimile(
            FacsimileRecord(**dict(row)), facsimile_root, work_id, include_related
        )
        for row in rows
    }
    for record in list_contribution_facsimiles(facsimile_root, work_id):
        facsimile = _public_facsimile(
            _contribution_facsimile_record(record), facsimile_root, work_id, include_related
        )
        facsimiles.setdefault(facsimile.image_id, facsimile)
    if settings is not None:
        published = resolve_published_facsimiles(
            settings,
            work_id,
            require_application_target=application_target,
        )
        if not published.target_authorized:
            facsimiles.clear()
        for image_id in published.claimed_image_ids:
            facsimiles.pop(image_id, None)
        for record in published.records:
            facsimiles[record.image_id] = _published_public_facsimile(
                record, work_id, include_related
            )
    return sorted(
        facsimiles.values(),
        key=lambda item: (
            item.sequence,
            item.scan_page is None,
            item.scan_page or 0,
            item.image_id,
        ),
    )


def get_facsimile_file(
    connection: sqlite3.Connection,
    work_id: str,
    image_id: str,
    facsimile_root: Path,
    include_related: bool = False,
    settings: Settings | None = None,
    application_target: bool = False,
) -> FacsimileFile | PublishedFile | None:
    if settings is not None:
        published = resolve_published_file(
            settings,
            work_id,
            image_id,
            require_application_target=application_target,
        )
        if not published.target_authorized:
            return None
        if published.matched:
            return published.file
    scope_clause = "1 = 1" if include_related else "w.relation_scope = ?"
    scope_parameters: list[object] = [] if include_related else ["strict_jiaxiu"]
    row = connection.execute(
        f"""
        SELECT fi.image_id, fi.source_id, fi.image_path, fi.scan_page, fi.print_page, fi.image_role,
               fi.file_format, fi.pixel_width, fi.pixel_height, fi.file_bytes, fi.sha256,
               fi.capture_method, fi.quality_note, fi.notes, wf.sequence, wf.locator,
               wf.notes AS association_notes
        FROM work_facsimiles AS wf
        JOIN works AS w USING (work_id)
        JOIN facsimile_images AS fi USING (image_id)
        WHERE wf.work_id = ? AND wf.image_id = ? AND {scope_clause}
        """,
        [work_id, image_id, *scope_parameters],
    ).fetchone()
    if row is None:
        record = find_contribution_facsimile(facsimile_root, work_id, image_id)
        if record is None:
            return None
        return resolve_facsimile_file(_contribution_facsimile_record(record), facsimile_root)
    return resolve_facsimile_file(FacsimileRecord(**dict(row)), facsimile_root)


def search_works(
    connection: sqlite3.Connection,
    query: str,
    limit: int,
    scope: str,
    facsimile_root: Path | None = None,
    settings: Settings | None = None,
) -> list[SearchHit]:
    normalized_query = query.strip()
    if not normalized_query:
        return []
    if len(normalized_query) > 200:
        raise ValueError("Search query must be 200 characters or fewer.")
    if scope not in _VALID_SCOPES:
        raise ValueError("Unknown research scope.")

    scope_clause = "1 = 1" if scope == "all" else "w.relation_scope = ?"
    scope_parameters: list[object] = [] if scope == "all" else [scope]
    match_clauses, match_parameters, tokens = _search_filter(normalized_query)
    match_clause = " AND ".join(match_clauses)
    order_clause = (
        "bm25(works_fts), w.title, w.work_id"
        if any(len(token) >= 3 for token in tokens)
        else "w.title, w.work_id"
    )
    rows = connection.execute(
        f"""
        SELECT w.*
        FROM works_fts
        JOIN v_works_full AS w USING (work_id)
        WHERE {match_clause} AND {scope_clause}
        ORDER BY {order_clause}
        LIMIT ?
        """,
        [*match_parameters, *scope_parameters, 100_000 if facsimile_root is not None else limit],
    ).fetchall()
    hits: list[SearchHit] = []
    for row in rows:
        details = _search_details(row, tokens)
        hits.append(
            SearchHit(
                work_id=row["work_id"],
                title=row["title"],
                authors=row["authors"],
                **details,
            )
        )
    if facsimile_root is None or scope not in {"strict_jiaxiu", "all"}:
        return hits[:limit]

    published_records = list_published_works(settings) if settings is not None else []
    published_ids = {record.work_id for record in published_records}
    curated_ids = {
        row["work_id"] for row in connection.execute("SELECT work_id FROM works").fetchall()
    }
    combined: dict[str, SearchHit] = {
        hit.work_id: hit for hit in hits if hit.work_id not in published_ids
    }
    for record in list_contribution_works(facsimile_root):
        work_id = str(record.get("work_id", ""))
        if not work_id or work_id in combined or work_id in curated_ids or work_id in published_ids:
            continue
        searchable = {
            "title": str(record.get("title", "")),
            "alternate_titles": "",
            "canonical_text": str(record.get("canonical_text", "")),
            "authors": str(record.get("authors", "")),
            "notes": str(record.get("notes", "")),
        }
        if all(
            any(token.casefold() in searchable[field].casefold() for field in _SEARCH_FIELDS)
            for token in tokens
        ):
            combined[work_id] = SearchHit(
                work_id=work_id,
                title=searchable["title"],
                authors=searchable["authors"],
                **_search_details(searchable, tokens),
            )
    for record in published_records:
        searchable = {
            "title": record.title,
            "alternate_titles": "",
            "canonical_text": record.canonical_text,
            "authors": record.authors,
            "notes": record.notes,
        }
        if all(
            any(token.casefold() in searchable[field].casefold() for field in _SEARCH_FIELDS)
            for token in tokens
        ):
            combined[record.work_id] = SearchHit(
                work_id=record.work_id,
                title=record.title,
                authors=record.authors,
                **_search_details(searchable, tokens),
            )
    curated_order = {hit.work_id: index for index, hit in enumerate(hits)}
    ordered = sorted(
        combined.values(),
        key=lambda hit: (
            curated_order.get(hit.work_id, len(curated_order)),
            hit.title.casefold(),
            hit.work_id,
        ),
    )
    return ordered[:limit]
