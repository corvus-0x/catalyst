---
name: new-connector
description: Scaffold a new Catalyst data source connector. Use when adding a new government or public-records data source. Invoke with /new-connector <source-name>.
---

# Catalyst — New Connector Scaffold

Catalyst has a consistent connector pattern. Every connector has the same 4-layer
structure. This skill walks through all four layers so nothing gets missed.

## Before you start — check the wiring table

Open `CLAUDE.md` and find the CONNECTOR WIRING STATUS table. Confirm the connector
you're adding is not already partially built. If a file exists, read it before
writing anything.

---

## Layer 1 — The connector file (`backend/investigations/<source>_connector.py`)

Every connector file follows this structure:

```python
"""
<Source Name> connector for Catalyst.

Strategy: <one-line description of fetch strategy — scraper, API, XML, CSV, etc.>

<3-5 sentence investigative context: why does this source matter for fraud cases?>

Data Source:
    <URL>
    <Any auth requirements, rate limits, or quirks>

How this works:
    <Step-by-step fetch strategy — include ASP.NET postback, pagination,
     auth handshake, or any non-obvious mechanism>
"""

from __future__ import annotations

import logging
# <standard library imports>
# <third-party: requests, bs4, lxml, etc.>

logger = logging.getLogger(__name__)

SOURCE_URL = "<base URL>"
REQUEST_TIMEOUT = (5, 30)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}


def search_<source>(query: str, **kwargs) -> dict:
    """
    Search <source> by name/EIN/identifier.

    Returns:
        {
            "results": [...],   # list of dicts, one per record
            "count": int,
            "source": "<source-slug>",
            "notes": [],        # warnings, rate-limit hits, partial results
        }
    """
    raise NotImplementedError
```

**Key conventions:**
- Return shape must always include `results`, `count`, `source`, `notes`
- Log warnings (never raise) for partial failures — return what you have
- `REQUEST_TIMEOUT = (5, 30)` — connect timeout, read timeout
- Include the investigative context docstring — it's how future sessions understand why

---

## Layer 2 — The view (`backend/investigations/views.py`)

Find the block of research endpoint views (search for `ResearchView` or `@api_view`
patterns near the other connector views). Add a new view following this pattern:

```python
@require_http_methods(["POST"])
def research_<source>(request, pk):
    """POST /api/cases/<uuid>/research/<source>/"""
    case = get_object_or_404(Case, pk=pk)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid JSON in request body"}, status=400)

    query = body.get("query", "").strip()
    if not query:
        return JsonResponse({"error": "Missing required field: query"}, status=400)

    with transaction.atomic():
        job = SearchJob.objects.create(
            case=case,
            job_type="<SOURCE_SLUG>",
            query_params={"query": query},
        )
        async_task("investigations.jobs.run_<source>_search", str(job.id))

    return JsonResponse(
        {"job_id": str(job.id), "status_url": f"/api/jobs/{job.id}/"},
        status=202,
    )
```

---

## Layer 3 — The URL (`backend/investigations/urls.py`)

Add the route in the `urlpatterns` list alongside the other research endpoints:

```python
path(
    "cases/<uuid:case_id>/research/<source>/",
    views.research_<source>,
    name="research-<source>",
),
```

---

## Layer 4 — The async job (`backend/investigations/jobs.py`)

Add the task function that the Django-Q2 worker will execute:

```python
def run_<source>_search(job_id: str) -> None:
    from .<source>_connector import search_<source>

    job = _load_and_mark_running(job_id)
    if job is None:
        return
    try:
        result = search_<source>(job.query_params["query"])
        _mark_success(job, result)
    except Exception as exc:
        _mark_failed(job, exc)
```

---

## After all four layers — update the docs

1. **`CLAUDE.md` CONNECTOR WIRING STATUS table** — add a row for the new connector
   with accurate `Has Endpoint?`, `Frontend Calls It?`, `Works on Railway?` values
2. **`docs/architecture/wiring-matrix.md`** — add the new client function once
   it exists in `frontend/src/api/`
3. **`STATUS.md` "Not yet wired" table** — add a row for the frontend gap if the
   UI caller doesn't exist yet

---

## Wiring checklist

- [ ] `<source>_connector.py` — search function returns `{results, count, source, notes}`
- [ ] `views.py` — POST view creates SearchJob, enqueues async task, returns 202
- [ ] `urls.py` — route added
- [ ] `jobs.py` — async task function added
- [ ] `frontend/src/api/` — client function added (or marked ⚠️ in wiring matrix)
- [ ] `CLAUDE.md` connector table updated
- [ ] `STATUS.md` updated
