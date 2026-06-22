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


def ensure_document_link(finding, document):
    """Ensure a non-legacy FindingDocument compatibility row exists for (finding, document)."""
    from .models import FindingDocument

    FindingDocument.objects.get_or_create(
        finding=finding, document=document, defaults={"is_legacy": False}
    )


def reap_document_link_if_orphaned(finding, document):
    """Remove the FindingDocument row iff no element still cites it AND it is not legacy."""
    from .models import FindingDocument, ThreadElementCitation

    still_cited = ThreadElementCitation.objects.filter(
        element__finding=finding, document=document
    ).exists()
    if still_cited:
        return
    FindingDocument.objects.filter(finding=finding, document=document, is_legacy=False).delete()
