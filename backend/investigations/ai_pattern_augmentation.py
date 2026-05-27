"""AI Pattern Augmentation — single-pass case-level pattern detector.

Reads a Case with its entities, findings, financial snapshots, and document
excerpts; asks Claude to highlight patterns the rule engine cannot see;
writes each returned pattern as a Finding with source=AI.

See docs/superpowers/specs/2026-04-21-async-frontend-and-ai-patterns-design.md
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

import anthropic
from django.db import transaction

from investigations import ai_proxy
from investigations.models import (
    AuditAction,
    AuditLog,
    Case,
    Document,
    FinancialSnapshot,
    Finding,
    FindingDocument,
    FindingEntity,
    FindingSource,
    Organization,
    Person,
    Property,
    Relationship,
)

logger = logging.getLogger(__name__)


class AIPatternError(RuntimeError):
    """Raised when the Claude API call for pattern analysis fails.

    The job runner catches this and marks the SearchJob FAILED with the
    real error message — instead of the previous behavior of returning
    "" and silently marking the job SUCCESS with zero findings.
    """


MAX_EXCERPT_CHARS = 2000
MAX_DOCUMENTS = 60
# Hard ceiling on the JSON-serialized context size we hand to Claude. Sonnet's
# input window is much larger, but a 100+ doc case at 2000 chars/doc plus
# entities and findings can blow past it; this also keeps cost predictable.
MAX_CONTEXT_CHARS = 80_000

# Retry config for transient Anthropic errors (rate-limit / 529 overload /
# brief network blips). Total wall-time worst case = sum of backoff sleeps.
CLAUDE_MAX_ATTEMPTS = 3
CLAUDE_BACKOFF_BASE = 2.0  # seconds; 2, 4, 8 ...

ALLOWED_AI_WEIGHTS = {"SPECULATIVE", "DIRECTIONAL"}
REQUIRED_PATTERN_FIELDS = (
    "title",
    "description",
    "rationale",
    "evidence_weight",
    "doc_refs",
    "suggested_action",
)

# Runtime guard against accusatory language. The system prompt forbids these
# words, but a model regression / jailbreak could still emit them. We scan
# user-visible fields and drop any pattern that contains them. The stems below
# anchor on word boundaries so "fraternity"/"decriminalize" are NOT flagged.
_FORBIDDEN_TERM_PATTERN = re.compile(
    r"\b(fraud|crim|illeg|guilt)\w*\b",
    re.IGNORECASE,
)
_FORBIDDEN_SCAN_FIELDS = ("title", "description", "rationale", "suggested_action")

SYSTEM_PROMPT = """\
You are a pattern-detection assistant for a public-records fraud
investigator. You are NOT an accuser. You highlight patterns across the
documents and entities you are shown and point toward what the
investigator should pull next. You never assert fraud; never use the words
"fraud", "crime", "illegal", or "guilty". Describe patterns, not verdicts.

Every pattern you return must:
  - cite at least one document by its Doc-N reference,
  - carry an `evidence_weight` of either `SPECULATIVE` or `DIRECTIONAL`
    (never `DOCUMENTED` or `TRACED` \u2014 those require human confirmation),
  - include a plain-language `rationale`,
  - include a concrete `suggested_action` (what to pull or check next).

Prioritize patterns the brittle rule engine cannot see: entity
disambiguation (same person with different name spellings), timeline
anomalies across documents, missing documents a pattern implies should
exist, narrative inconsistencies between filings.

Respond with strict JSON only, matching this schema:
{
  "patterns": [
    {
      "title": "...",
      "description": "...",
      "rationale": "...",
      "evidence_weight": "SPECULATIVE" | "DIRECTIONAL",
      "entity_refs": ["uuid", ...],
      "doc_refs": ["Doc-1", ...],
      "suggested_action": "..."
    }
  ]
}
If you find no patterns, return {"patterns": []}. No prose outside JSON.
"""


def _format_990_snapshot(snap: FinancialSnapshot) -> str:
    """Serialize a FinancialSnapshot as structured text for AI context.

    Used instead of raw OCR text for IRS_990 documents that have a linked
    snapshot. Structured data is more token-efficient (~600 chars) and covers
    governance flags and compensation figures that appear 15-30 pages into
    the PDF — well beyond the 2000-char OCR excerpt limit.
    """

    def _money(val: int | None) -> str:
        return f"${val:,}" if val is not None else "unknown"

    def _flag(val: bool | None) -> str:
        return "YES" if val is True else ("NO" if val is False else "unknown")

    return "\n".join([
        "[IRS Form 990 — Structured Data]",
        (
            f"EIN: {snap.ein or 'unknown'}  "
            f"Tax Year: {snap.tax_year or 'unknown'}  "
            f"Form: {snap.form_type or 'unknown'}"
        ),
        "--- REVENUE (Part I) ---",
        f"Total contributions: {_money(snap.total_contributions)}",
        f"Program service revenue: {_money(snap.program_service_revenue)}",
        f"Investment income: {_money(snap.investment_income)}",
        f"Other revenue: {_money(snap.other_revenue)}",
        f"Total revenue: {_money(snap.total_revenue)}",
        "--- EXPENSES (Part I) ---",
        f"Grants paid: {_money(snap.grants_paid)}",
        f"Salaries & compensation: {_money(snap.salaries_and_compensation)}",
        f"Professional fundraising: {_money(snap.professional_fundraising)}",
        f"Other expenses: {_money(snap.other_expenses)}",
        f"Total expenses: {_money(snap.total_expenses)}",
        f"Net (revenue less expenses): {_money(snap.revenue_less_expenses)}",
        "--- BALANCE SHEET (Part X) ---",
        (
            f"Total assets BOY/EOY: {_money(snap.total_assets_boy)}"
            f" / {_money(snap.total_assets_eoy)}"
        ),
        (
            f"Total liabilities BOY/EOY: {_money(snap.total_liabilities_boy)}"
            f" / {_money(snap.total_liabilities_eoy)}"
        ),
        f"Net assets BOY/EOY: {_money(snap.net_assets_boy)} / {_money(snap.net_assets_eoy)}",
        "--- GOVERNANCE & COMPENSATION ---",
        f"Voting members: {snap.num_voting_members or 'unknown'}  "
        f"Independent: {snap.num_independent_members or 'unknown'}",
        f"Employees: {snap.num_employees or 'unknown'}",
        f"Officer compensation total: {_money(snap.officer_compensation_total)}",
        f"Related-party txns disclosed (Part IV L28): {_flag(snap.related_party_disclosed)}",
        f"Conflict of interest policy (Part VI Line 12a): {_flag(snap.has_coi_policy)}",
        f"Whistleblower policy (Part VI Line 13): {_flag(snap.has_whistleblower_policy)}",
        f"Document retention policy (Part VI Line 14): {_flag(snap.has_document_retention_policy)}",
        f"Extraction confidence: {snap.confidence:.2f}  Source: {snap.source}",
    ])


def build_context(case: Case) -> dict[str, Any]:
    ctx, _, _em = build_context_with_refs(case)
    return ctx


def build_context_with_refs(
    case: Case,
) -> tuple[dict[str, Any], dict[str, str], dict[str, str]]:
    persons = list(Person.objects.filter(case=case))
    orgs = list(Organization.objects.filter(case=case))
    properties = list(Property.objects.filter(case=case))
    snapshots = list(FinancialSnapshot.objects.filter(case=case))
    relationships = list(Relationship.objects.filter(case=case))
    existing_findings = list(Finding.objects.filter(case=case))

    # Newest documents first — most likely to be relevant to the active
    # investigation. Cap at MAX_DOCUMENTS regardless.
    docs = list(Document.objects.filter(case=case).order_by("-uploaded_at")[:MAX_DOCUMENTS])

    # Build a doc_id → FinancialSnapshot lookup from the snapshots already
    # loaded above (no extra DB query). Used to substitute structured data
    # for IRS_990 documents instead of the raw OCR excerpt.
    snap_by_doc: dict[str, FinancialSnapshot] = {
        str(s.document_id): s for s in snapshots
    }

    doc_ref_map: dict[str, str] = {}
    doc_entries: list[dict[str, Any]] = []
    for i, d in enumerate(docs, start=1):
        ref = f"Doc-{i}"
        doc_ref_map[ref] = str(d.id)

        # IRS_990 docs with a linked snapshot get structured data instead of
        # raw OCR. Structured data is ~600 chars of pure signal (revenue,
        # expenses, governance flags, officer pay) vs. 2000 chars of OCR
        # noise from the cover page that doesn't contain any of that.
        doc_id_str = str(d.id)
        if d.doc_type in ("IRS_990", "IRS_990T") and doc_id_str in snap_by_doc:
            excerpt = _format_990_snapshot(snap_by_doc[doc_id_str])
        else:
            excerpt = (d.extracted_text or "")[:MAX_EXCERPT_CHARS]

        doc_entries.append(
            {
                "ref": ref,
                "doc_type": d.doc_type or "",
                "filename": d.filename,
                "text_excerpt": excerpt,
            }
        )

    # Build a UUID → entity_type lookup so FindingEntity rows get the correct
    # type label ("person", "organization", "property") instead of "UNKNOWN".
    # Only the three types included in the context are covered; anything else
    # falls back to "UNKNOWN" at write time.
    entity_ref_map: dict[str, str] = {}
    for p in persons:
        entity_ref_map[str(p.id)] = "person"
    for o in orgs:
        entity_ref_map[str(o.id)] = "organization"
    for pr in properties:
        entity_ref_map[str(pr.id)] = "property"

    ctx: dict[str, Any] = {
        "case": {
            "id": str(case.id),
            "name": case.name,
            "status": case.status,
        },
        "entities": {
            "persons": [
                {
                    "id": str(p.id),
                    "name": p.full_name,
                    "aliases": list(p.aliases or []),
                    "role_tags": list(p.role_tags or []),
                }
                for p in persons
            ],
            "organizations": [
                {
                    "id": str(o.id),
                    "name": o.name,
                    "ein": o.ein or "",
                    "org_type": o.org_type or "",
                }
                for o in orgs
            ],
            "properties": [
                {
                    "id": str(pr.id),
                    "parcel_number": pr.parcel_number or "",
                    "address": pr.address or "",
                    "assessed_value": float(pr.assessed_value or 0),
                    "purchase_price": float(pr.purchase_price or 0),
                }
                for pr in properties
            ],
        },
        "financial_snapshots": [
            {
                "org_id": str(s.organization_id) if s.organization_id else "",
                "tax_year": s.tax_year,
                "revenue": int(s.total_revenue or 0),
                "expenses": int(s.total_expenses or 0),
                "net_assets": int(s.net_assets_eoy or 0),
            }
            for s in snapshots
        ],
        "relationships": [
            {
                "person_a_id": str(r.person_a_id),
                "person_b_id": str(r.person_b_id),
                "relationship_type": r.relationship_type,
            }
            for r in relationships
        ],
        "existing_findings": [
            {
                "rule_id": f.rule_id or "",
                "title": f.title,
                "status": f.status,
                "evidence_weight": f.evidence_weight,
                "source": f.source,
            }
            for f in existing_findings
        ],
        "documents": doc_entries,
    }
    _enforce_context_budget(ctx, doc_ref_map)
    return ctx, doc_ref_map, entity_ref_map


def _enforce_context_budget(
    ctx: dict[str, Any],
    doc_ref_map: dict[str, str],
) -> None:
    """Trim the context in-place until it fits MAX_CONTEXT_CHARS.

    Documents are by far the largest input. Drop them oldest-first (the
    list is newest-first, so we pop from the tail) until under budget.
    Once dropped, the corresponding Doc-N reference is removed from
    doc_ref_map so validate_patterns() will reject any AI citation back
    to a missing doc instead of accepting a dangling reference.
    """
    while len(json.dumps(ctx)) > MAX_CONTEXT_CHARS and ctx["documents"]:
        dropped = ctx["documents"].pop()
        doc_ref_map.pop(dropped["ref"], None)
        logger.info(
            "Trimmed AI context: dropped %s (%s) to fit %d-char budget",
            dropped["ref"],
            dropped["filename"],
            MAX_CONTEXT_CHARS,
        )


def parse_response(raw: str) -> list[dict[str, Any]]:
    """Parse Claude's response to a list of pattern dicts. Never raises."""
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        logger.warning("AI pattern response was not valid JSON")
        return []
    if not isinstance(data, dict):
        return []
    patterns = data.get("patterns")
    if not isinstance(patterns, list):
        return []
    return [p for p in patterns if isinstance(p, dict)]


def validate_patterns(
    patterns: list[dict[str, Any]],
    doc_ref_map: dict[str, str],
) -> tuple[list[dict[str, Any]], int]:
    """Keep only patterns with real doc_refs and required fields.

    Coerces any evidence_weight that isn't SPECULATIVE or DIRECTIONAL down
    to DIRECTIONAL. Returns (kept, dropped_count).
    """
    kept: list[dict[str, Any]] = []
    dropped = 0
    for p in patterns:
        if not all(field in p for field in REQUIRED_PATTERN_FIELDS):
            dropped += 1
            continue
        doc_refs = p.get("doc_refs") or []
        if not isinstance(doc_refs, list) or not doc_refs:
            dropped += 1
            continue
        if any(ref not in doc_ref_map for ref in doc_refs):
            dropped += 1
            logger.info("Dropping AI pattern with unknown doc_ref: %s", doc_refs)
            continue
        weight = p.get("evidence_weight", "")
        if weight not in ALLOWED_AI_WEIGHTS:
            logger.info("Coercing AI evidence_weight %s -> DIRECTIONAL", weight)
            p["evidence_weight"] = "DIRECTIONAL"
        if _contains_forbidden_terms(p):
            dropped += 1
            logger.warning(
                "Dropping AI pattern with forbidden accusatory language",
                extra={"title": str(p.get("title", ""))[:120]},
            )
            continue
        kept.append(p)
    return kept, dropped


def _contains_forbidden_terms(pattern: dict[str, Any]) -> bool:
    """True if any user-visible field contains an accusatory term."""
    for field in _FORBIDDEN_SCAN_FIELDS:
        value = pattern.get(field)
        if isinstance(value, str) and _FORBIDDEN_TERM_PATTERN.search(value):
            return True
    return False


def call_claude(context: dict[str, Any]) -> str:
    """Single Claude call with the pattern-detection system prompt.

    Returns the raw model text (expected JSON matching the SYSTEM_PROMPT
    schema). Thin wrapper so tests can mock this function.

    We do NOT call ai_proxy._call_ai here — that helper json.loads the
    response and returns a dict. parse_response() below expects a string
    so it can defensively handle malformed output without raising.

    Retries up to CLAUDE_MAX_ATTEMPTS on transient errors (rate-limit,
    overloaded, network blips). Permanent errors (auth, bad request,
    content-policy refusal) are raised immediately as AIPatternError.
    """
    user_message = (
        "Here is the case. Return patterns as strict JSON per the schema in "
        "the system prompt.\n\n<case>\n" + json.dumps(context) + "\n</case>"
    )
    last_exc: Exception | None = None
    for attempt in range(1, CLAUDE_MAX_ATTEMPTS + 1):
        try:
            client = ai_proxy._get_client()
            response = client.messages.create(
                model=ai_proxy.MODEL_SONNET,
                max_tokens=4096,
                temperature=0.2,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_message}],
            )
            raw = response.content[0].text or ""
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                lines = [line for line in lines if not line.strip().startswith("```")]
                cleaned = "\n".join(lines).strip()
            return cleaned
        except (
            anthropic.RateLimitError,
            anthropic.APIConnectionError,
            anthropic.APITimeoutError,
            anthropic.InternalServerError,
        ) as exc:
            last_exc = exc
            if attempt < CLAUDE_MAX_ATTEMPTS:
                sleep_for = CLAUDE_BACKOFF_BASE**attempt
                logger.warning(
                    "Transient Claude error on attempt %d/%d: %s; retrying in %.1fs",
                    attempt,
                    CLAUDE_MAX_ATTEMPTS,
                    exc,
                    sleep_for,
                )
                time.sleep(sleep_for)
                continue
        except Exception as exc:
            # Permanent error (auth, bad request, content-policy, JSON
            # decode etc.) — fail fast, no retry.
            logger.exception("AI pattern Claude call failed: %s", exc)
            raise AIPatternError(f"Claude API call failed: {exc}") from exc

    # Exhausted retries on a transient error.
    logger.exception(
        "AI pattern Claude call failed after %d attempts: %s",
        CLAUDE_MAX_ATTEMPTS,
        last_exc,
    )
    raise AIPatternError(
        f"Claude API call failed after {CLAUDE_MAX_ATTEMPTS} attempts: {last_exc}"
    ) from last_exc


def analyze_case(case_id: Any, job: Any = None) -> dict[str, Any]:
    """Run the AI pattern pass for one case. Returns a summary dict.

    Parameters
    ----------
    case_id:
        Primary key of the Case to analyze.
    job:
        Optional SearchJob instance (passed by run_ai_pattern_analysis in
        jobs.py). When provided, each created Finding is linked back to this
        job via Finding.ai_run, and the job's id and model version are stamped
        into evidence_snapshot for chain-of-custody.
    """
    case = Case.objects.get(pk=case_id)
    context, doc_ref_map, entity_ref_map = build_context_with_refs(case)
    raw = call_claude(context)
    patterns = parse_response(raw)
    kept, dropped = validate_patterns(patterns, doc_ref_map)

    # Stamp every finding's evidence_snapshot with the job id and model version
    # so the referral package can cite exactly which run produced each angle.
    job_id_str = str(job.id) if job else None

    # Build a normalized-title set for existing AI findings so we can skip
    # duplicates when the investigator runs pattern analysis more than once.
    # Normalization strips punctuation/case so minor wording differences don't
    # sneak past the check.
    existing_ai_titles = {
        re.sub(r"\W+", "", f.title.lower())
        for f in Finding.objects.filter(case=case, source=FindingSource.AI)
    }

    created = 0
    for p in kept:
        normalized = re.sub(r"\W+", "", p["title"].lower())
        if normalized in existing_ai_titles:
            logger.info("Skipping duplicate AI finding: %r", p["title"][:80])
            dropped += 1
            continue
        # Each finding gets its own savepoint — one bad pattern (e.g. a
        # duplicate doc_ref from the LLM that trips FindingDocument's
        # UNIQUE(finding, document) constraint) must not roll back the
        # earlier, valid findings.
        try:
            with transaction.atomic():
                finding = Finding.objects.create(
                    case=case,
                    rule_id="",
                    title=p["title"][:500],
                    description=p["description"],
                    # Rationale is the AI's reasoning — it starts as AI_DRAFT.
                    # The investigator can edit it (→ AI_ASSISTED) or replace
                    # it entirely (→ HUMAN) via a PATCH to the finding.
                    narrative=p.get("rationale", ""),
                    narrative_source="AI_DRAFT",
                    severity="INFORMATIONAL",
                    status="NEW",
                    evidence_weight=p["evidence_weight"],
                    source=FindingSource.AI,
                    ai_run=job,
                    evidence_snapshot={
                        "rationale": p["rationale"],
                        "suggested_action": p["suggested_action"],
                        "doc_refs": p["doc_refs"],
                        "entity_refs": p.get("entity_refs", []),
                        # Model version and job id for chain-of-custody.
                        # If the model is ever updated, findings created under
                        # the old version stay traceable to it.
                        "ai_model": ai_proxy.MODEL_SONNET,
                        "job_id": job_id_str,
                        # Map each [Doc-N] citation to a stable document UUID.
                        # The doc numbering is assigned at analysis time (newest
                        # first); if new documents are uploaded later, the same
                        # [Doc-3] tag would refer to a different file. Storing
                        # the resolution here lets the frontend display the
                        # correct filename regardless of upload order.
                        "doc_ref_resolution": {
                            ref: doc_ref_map[ref]
                            for ref in p["doc_refs"]
                            if ref in doc_ref_map
                        },
                    },
                )
                # Dedupe doc_refs; Claude occasionally repeats a ref and the
                # (finding, document) unique constraint would otherwise raise.
                seen_docs: set[str] = set()
                for ref in p["doc_refs"]:
                    doc_id = doc_ref_map.get(ref)
                    if not doc_id or doc_id in seen_docs:
                        continue
                    seen_docs.add(doc_id)
                    FindingDocument.objects.create(
                        finding=finding,
                        document_id=doc_id,
                    )
                seen_entities: set[str] = set()
                for entity_id in p.get("entity_refs", []):
                    if not entity_id or entity_id in seen_entities:
                        continue
                    seen_entities.add(entity_id)
                    try:
                        with transaction.atomic():
                            FindingEntity.objects.create(
                                finding=finding,
                                entity_id=entity_id,
                                # Resolve from the context map; fall back to
                                # "UNKNOWN" only for entity types not included
                                # in the pattern analysis context (e.g. financial
                                # instruments, which Claude never references).
                                entity_type=entity_ref_map.get(entity_id, "UNKNOWN"),
                            )
                    except Exception:
                        logger.info("Skipping invalid entity_ref %s", entity_id)

                # Audit each AI finding individually so the audit log can answer
                # "which run created this angle?" via case_id + record_id.
                AuditLog.log(
                    action=AuditAction.AI_FINDING_CREATED,
                    table_name="findings",
                    record_id=finding.pk,
                    case_id=case.pk,
                    after_state={
                        "title": finding.title,
                        "evidence_weight": finding.evidence_weight,
                        "job_id": job_id_str,
                        "ai_model": ai_proxy.MODEL_SONNET,
                    },
                )
            created += 1
        except Exception as exc:  # noqa: BLE001 — drop bad pattern, keep rest
            logger.warning(
                "Dropping AI pattern %r due to write error: %s",
                p.get("title"),
                exc,
            )
            dropped += 1

    # Audit the run-level result: how many findings were created vs. dropped.
    AuditLog.log(
        action=AuditAction.AI_PATTERN_RUN_COMPLETED,
        table_name="search_jobs",
        record_id=job.pk if job else None,
        case_id=case.pk,
        after_state={
            "findings_created": created,
            "patterns_dropped": dropped,
            "ai_model": ai_proxy.MODEL_SONNET,
            "job_id": job_id_str,
        },
    )

    return {
        "findings_created": created,
        "patterns_dropped": dropped,
        "case_id": str(case.id),
    }
