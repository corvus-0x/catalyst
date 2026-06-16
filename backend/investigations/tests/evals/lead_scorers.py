"""Pure scoring + deterministic guard functions for the AI-lead eval harness.

No DB, no Claude — every function takes plain data so it runs in normal CI.
"""

from __future__ import annotations

import re

# Mirror ai_pattern_augmentation._FORBIDDEN_TERM_PATTERN: accusatory stems on
# word boundaries so "fraternity"/"decriminalize" are NOT flagged.
_FORBIDDEN_TERM_PATTERN = re.compile(r"\b(fraud|crim|illeg|guilt)\w*\b", re.IGNORECASE)
_SCAN_ATTRS = ("title", "description", "narrative")


def citation_integrity(leads, valid_doc_ids: set[str]) -> bool:
    """True iff every document id each lead cites exists in valid_doc_ids.

    Regression guard on validate_patterns (which already drops unresolved
    doc_refs before a Lead is persisted) — this should always pass.
    """
    for lead in leads:
        resolution = (lead.evidence_snapshot or {}).get("doc_ref_resolution", {})
        for doc_id in resolution.values():
            if doc_id not in valid_doc_ids:
                return False
    return True


def forbidden_terms_clean(leads) -> bool:
    """True iff no lead's visible text contains an accusatory term.

    Regression guard on the generator's own forbidden-term scan.
    """
    for lead in leads:
        for attr in _SCAN_ATTRS:
            value = getattr(lead, attr, "") or ""
            if _FORBIDDEN_TERM_PATTERN.search(value):
                return False
    return True


def faithfulness(leads, support_flags: list[bool]) -> tuple[float, list[bool]]:
    """Precision: supported leads / total. 1.0 when there are no leads."""
    if not leads:
        return 1.0, []
    supported = sum(1 for flag in support_flags if flag)
    return supported / len(leads), list(support_flags)


def overreach(leads, overreach_flags: list[bool]) -> tuple[float, list[bool]]:
    """Inverse risk: over-claiming leads / total. 0.0 when there are no leads."""
    if not leads:
        return 0.0, []
    over = sum(1 for flag in overreach_flags if flag)
    return over / len(leads), list(overreach_flags)
