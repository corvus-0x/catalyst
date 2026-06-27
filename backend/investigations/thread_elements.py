"""Thread-element predicates + document_links sync helpers.

These predicates are the single definition of the softened gate ingredients.
As of Phase 4B they are wired into both gates: ``finding_has_cited_assertion``
gates the Tier-1 tie-off (``FindingUpdateSerializer``) and, together with
``finding_has_handoff_ready_assertion``, the Tier-2 referral-grade predicate
(``referral_grade.py``).
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
    """Ensure a FindingDocument compatibility row exists for (finding, document).

    Creates a non-legacy row when none exists. A pre-existing row is left as-is —
    in particular an ``is_legacy=True`` row is NOT promoted to non-legacy, because
    legacy links (the ``add_document_ids`` path / pre-Phase-4 backfill, e.g.
    referral-PDF citations) must survive even when an assertion later cites the same
    document. So ``is_legacy`` means "this link has a legacy reason to exist", not
    "this link has no citation reason"; ``reap_document_link_if_orphaned`` therefore
    never removes it. (4B note: if the gate needs to tell "purely legacy" from
    "legacy + also cited" apart, that distinction must be modeled then — a single
    boolean cannot carry it, and promoting here would make a legacy link reapable.)
    """
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
