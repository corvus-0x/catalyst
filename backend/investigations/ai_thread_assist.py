"""AI Thread Assist — assist-only freeform→assertion proposals (Phase 4D).

Reads one Finding's freeform material (narrative, NOTE/QUESTION elements) plus
the case documents most relevant to it, and asks Claude to PROPOSE structured
assertions the investigator could add to the thread.

Hard constraints (spec §11 "Phase 4D — AI-assisted structuring"):
- Proposals are returned in the job result ONLY — this module never creates
  ThreadElement or ThreadElementCitation rows. The human accepts each proposal
  in the Thread Builder, which goes through the normal element/citation
  endpoints. Nothing AI produces is authoritative until accepted.
- Never sets `handoff_ready`, never touches `gate_version` or the
  referral-grade predicate.
- Surfaced under the "Lead" vocabulary in the UI (banned-strings gate applies).

See docs/superpowers/specs/2026-06-22-case-map-phase-4-thread-builder-design.md
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from investigations import ai_gateway, ai_proxy
from investigations.models import (
    AuditAction,
    AuditLog,
    Document,
    Finding,
    ThreadElementType,
)

logger = logging.getLogger(__name__)


class AIThreadAssistError(RuntimeError):
    """Raised when the Claude call for thread assist fails.

    The job runner catches this and marks the SearchJob FAILED with the real
    error message (mirrors AIPatternError in ai_pattern_augmentation.py).
    """


MAX_EXCERPT_CHARS = 2000
MAX_DOCUMENTS = 20
# Thread assist is finding-scoped, so the context is naturally smaller than
# the case-level pattern pass; a tighter budget keeps cost per click low.
MAX_CONTEXT_CHARS = 40_000
MAX_PROPOSALS = 10
MAX_PROPOSAL_CHARS = 500

# Same runtime guard as ai_pattern_augmentation: the system prompt forbids
# accusatory language, but a model regression could still emit it. Proposals
# containing these stems are dropped before they reach the investigator.
_FORBIDDEN_TERM_PATTERN = re.compile(
    r"\b(fraud|crim|illeg|guilt)\w*\b",
    re.IGNORECASE,
)

SYSTEM_PROMPT = """\
You help a public-records investigator turn freeform notes into structured,
checkable assertions. You are NOT an accuser and NOT the judge of what is
proven. You propose; the investigator decides. Never use the words "fraud",
"crime", "illegal", or "guilty". Describe facts, not verdicts.

You are given ONE investigation thread: its title, description, freeform
narrative, context notes, open questions, and the assertions it already has,
plus excerpts of the case's source documents (referenced as Doc-N).

Propose assertions that:
  - restate ONE discrete, checkable statement each (no compound claims),
  - come from the thread's own freeform material (do not invent facts),
  - do NOT duplicate an existing assertion,
  - cite Doc-N references ONLY when the excerpt shown genuinely supports the
    statement; an empty doc_refs list is correct when no shown excerpt does,
  - stay under 500 characters each.

For each proposal include a short `basis` quoting or paraphrasing the piece
of freeform material it came from, so the investigator can verify the source.

Respond with strict JSON only, matching this schema:
{
  "proposals": [
    {
      "text": "...",
      "doc_refs": ["Doc-1", ...],
      "basis": "..."
    }
  ]
}
If the freeform material contains nothing assertable, return
{"proposals": []}. No prose outside JSON.
"""


def build_thread_context(finding: Finding) -> tuple[dict[str, Any], dict[str, str]]:
    """Assemble the finding-scoped context and the Doc-N -> uuid reference map.

    Documents already cited/linked on the finding come first (most likely to
    support its assertions), then the rest of the case's documents newest
    first, capped at MAX_DOCUMENTS total.
    """
    elements = list(finding.elements.all())

    def _texts(el_type: str) -> list[str]:
        return [e.text for e in elements if e.element_type == el_type and e.text.strip()]

    linked_doc_ids = [str(dl.document_id) for dl in finding.document_links.all()]
    linked_docs = list(Document.objects.filter(id__in=linked_doc_ids))
    other_docs = list(
        Document.objects.filter(case=finding.case)
        .exclude(id__in=linked_doc_ids)
        .order_by("-uploaded_at")
    )
    docs = (linked_docs + other_docs)[:MAX_DOCUMENTS]

    doc_ref_map: dict[str, str] = {}
    doc_entries: list[dict[str, Any]] = []
    for i, d in enumerate(docs, start=1):
        ref = f"Doc-{i}"
        doc_ref_map[ref] = str(d.id)
        doc_entries.append(
            {
                "ref": ref,
                "doc_type": d.doc_type or "",
                "filename": d.filename,
                "text_excerpt": (d.extracted_text or "")[:MAX_EXCERPT_CHARS],
            }
        )

    ctx: dict[str, Any] = {
        "thread": {
            "title": finding.title,
            "description": finding.description or "",
            "narrative": finding.narrative or "",
            "notes": _texts(ThreadElementType.NOTE),
            "open_questions": _texts(ThreadElementType.QUESTION),
            "existing_assertions": _texts(ThreadElementType.ASSERTION),
        },
        "documents": doc_entries,
    }
    _enforce_context_budget(ctx, doc_ref_map)
    return ctx, doc_ref_map


def _enforce_context_budget(ctx: dict[str, Any], doc_ref_map: dict[str, str]) -> None:
    """Trim documents in-place (least-relevant last) until under budget.

    Mirrors ai_pattern_augmentation: a dropped document's Doc-N ref is removed
    from doc_ref_map so validation rejects citations to it instead of keeping
    a dangling reference.
    """
    while len(json.dumps(ctx)) > MAX_CONTEXT_CHARS and ctx["documents"]:
        dropped = ctx["documents"].pop()
        doc_ref_map.pop(dropped["ref"], None)
        logger.info(
            "Trimmed thread-assist context: dropped %s (%s) to fit %d-char budget",
            dropped["ref"],
            dropped["filename"],
            MAX_CONTEXT_CHARS,
        )


def parse_response(raw: str) -> list[dict[str, Any]]:
    """Parse Claude's response to a list of proposal dicts. Never raises."""
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        logger.warning("Thread-assist response was not valid JSON")
        return []
    if not isinstance(data, dict):
        return []
    proposals = data.get("proposals")
    if not isinstance(proposals, list):
        return []
    return [p for p in proposals if isinstance(p, dict)]


def validate_proposals(
    proposals: list[dict[str, Any]],
    doc_ref_map: dict[str, str],
) -> tuple[list[dict[str, Any]], int]:
    """Keep only well-formed, non-accusatory proposals. Returns (kept, dropped).

    Unlike the pattern pass, citations here are OPTIONAL — an uncited proposal
    is a legitimate analysis-role assertion. Unknown Doc-N refs are stripped
    from a proposal (logged) rather than dropping the whole proposal, because
    the citation is a suggestion the human vets anyway; the assertion text is
    the primary payload.
    """
    kept: list[dict[str, Any]] = []
    dropped = 0
    for p in proposals:
        text = p.get("text")
        if not isinstance(text, str) or not text.strip():
            dropped += 1
            continue
        text = text.strip()[:MAX_PROPOSAL_CHARS]
        if _FORBIDDEN_TERM_PATTERN.search(text):
            dropped += 1
            logger.warning(
                "Dropping thread-assist proposal with forbidden accusatory language",
                extra={"text": text[:120]},
            )
            continue
        raw_refs = p.get("doc_refs")
        doc_refs = [r for r in raw_refs if isinstance(r, str)] if isinstance(raw_refs, list) else []
        known_refs = [r for r in doc_refs if r in doc_ref_map]
        if len(known_refs) != len(doc_refs):
            logger.info(
                "Stripping unknown doc_refs from thread-assist proposal: %s",
                [r for r in doc_refs if r not in doc_ref_map],
            )
        basis = p.get("basis")
        kept.append(
            {
                "text": text,
                "doc_refs": known_refs,
                "basis": basis.strip()[:MAX_PROPOSAL_CHARS] if isinstance(basis, str) else "",
            }
        )
        if len(kept) >= MAX_PROPOSALS:
            break
    return kept, dropped


def call_claude(context: dict[str, Any]) -> str:
    """Single Claude call with the thread-assist system prompt.

    Thin wrapper so tests can mock this function (same pattern as
    ai_pattern_augmentation.call_claude).
    """
    user_message = (
        "Here is the thread and its source documents. Return proposals as "
        "strict JSON per the schema in the system prompt.\n\n<thread>\n"
        + json.dumps(context)
        + "\n</thread>"
    )
    result = ai_gateway.call_json(
        system=SYSTEM_PROMPT,
        user_message=user_message,
        model=ai_proxy.MODEL_SONNET,
        temperature=0.2,
        max_tokens=4096,
    )
    if result.error or result.payload is None:
        raise AIThreadAssistError(result.error or "Claude API call failed")
    return json.dumps(result.payload)


def propose_assertions(finding_id: Any, job: Any = None) -> dict[str, Any]:
    """Run the assist pass for one finding. Returns the proposals summary.

    WRITES NOTHING except the run-level AuditLog entry: proposals live only in
    the returned dict (persisted by the job runner into SearchJob.result).
    Accepting a proposal is a separate human action through the normal
    element/citation endpoints.
    """
    finding = Finding.objects.select_related("case").get(pk=finding_id)
    context, doc_ref_map = build_thread_context(finding)
    raw = call_claude(context)
    kept, dropped = validate_proposals(parse_response(raw), doc_ref_map)

    # Resolve each proposal's Doc-N refs to stable document ids + filenames so
    # the frontend can render and submit citations without re-deriving the
    # numbering (which is assigned at analysis time and not stable).
    doc_names = {
        str(d.id): d.filename
        for d in Document.objects.filter(id__in=[doc_ref_map[r] for r in doc_ref_map])
    }
    proposals = []
    for p in kept:
        documents = [
            {"document_id": doc_ref_map[r], "filename": doc_names.get(doc_ref_map[r], "")}
            for r in p["doc_refs"]
        ]
        proposals.append({**p, "documents": documents})

    job_id_str = str(job.id) if job else None
    AuditLog.log(
        action=AuditAction.AI_THREAD_ASSIST_COMPLETED,
        table_name="search_jobs",
        record_id=job.pk if job else None,
        case_id=finding.case.pk,
        after_state={
            "finding_id": str(finding.id),
            "proposals_returned": len(proposals),
            "proposals_dropped": dropped,
            "ai_model": ai_proxy.MODEL_SONNET,
            "job_id": job_id_str,
        },
    )

    return {
        "finding_id": str(finding.id),
        "case_id": str(finding.case.id),
        "proposals": proposals,
        "proposals_dropped": dropped,
        "ai_model": ai_proxy.MODEL_SONNET,
    }
