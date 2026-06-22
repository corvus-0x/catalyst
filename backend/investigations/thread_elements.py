"""Thread-element predicates + document_links sync helpers.

NOTE: the predicates here are built in 4A-additive but are NOT wired into any
gate (FindingUpdateSerializer / referral_grade.py) until 4B. Single definition
of the softened gate ingredients.
"""

from .models import ThreadElementType


def assertion_is_cited(element) -> bool:
    """True iff element is an ASSERTION with text and at least one citation."""
    return (
        element.element_type == ThreadElementType.ASSERTION
        and bool((element.text or "").strip())
        and element.citations.exists()
    )


def finding_has_cited_assertion(finding) -> bool:
    """Tier-1 (CONFIRMED) ingredient — used by 4B: at least one cited assertion."""
    return any(
        assertion_is_cited(e)
        for e in finding.elements.filter(element_type=ThreadElementType.ASSERTION)
    )


def finding_has_handoff_ready_assertion(finding) -> bool:
    """Tier-2 (referral-grade) ingredient — used by 4B: a handoff_ready assertion with text."""
    return any(
        bool((e.text or "").strip())
        for e in finding.elements.filter(
            element_type=ThreadElementType.ASSERTION, handoff_ready=True
        )
    )
