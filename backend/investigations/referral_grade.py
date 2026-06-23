"""Single source of truth for the referral-grade predicate (Phase 4B: dual-version).

An Angle (Finding) is "referral-grade" when CONFIRMED, weight ∈ {DOCUMENTED, TRACED},
overreach_reviewed, and ≥1 cited document — PLUS, for ASSERTION_V1 threads, ≥1 cited
assertion AND ≥1 handoff_ready assertion (a single cited+handoff_ready assertion
satisfies both). LEGACY_NARRATIVE threads keep the pre-4B predicate (grandfathered).
is_referral_grade() and referral_grade_qs() MUST agree (parity test).
"""

from django.db.models import Count, Exists, OuterRef, Q

from .models import (
    EvidenceWeight,
    Finding,
    FindingStatus,
    GateVersion,
    ThreadElement,
    ThreadElementType,
)
from .thread_elements import finding_has_cited_assertion, finding_has_handoff_ready_assertion

REFERRAL_WEIGHTS = [EvidenceWeight.DOCUMENTED, EvidenceWeight.TRACED]


def referral_grade_qs(case):
    """Queryset of referral-grade Angles for a case (a single SQL statement)."""
    cited_assertion = ThreadElement.objects.filter(
        finding=OuterRef("pk"),
        element_type=ThreadElementType.ASSERTION,
        citations__isnull=False,
        text__gt="",
    )
    handoff_assertion = ThreadElement.objects.filter(
        finding=OuterRef("pk"),
        element_type=ThreadElementType.ASSERTION,
        handoff_ready=True,
        text__gt="",
    )
    base = (
        Finding.objects.filter(
            case=case,
            status=FindingStatus.CONFIRMED,
            evidence_weight__in=REFERRAL_WEIGHTS,
            overreach_reviewed=True,
        )
        .annotate(_citation_count=Count("document_links"))
        .filter(_citation_count__gt=0)
    )
    return base.filter(
        Q(gate_version=GateVersion.LEGACY_NARRATIVE)
        | (
            Q(gate_version=GateVersion.ASSERTION_V1)
            & Exists(cited_assertion)
            & Exists(handoff_assertion)
        )
    )


def is_referral_grade(finding) -> bool:
    """True iff a single Finding instance meets every referral-grade condition."""
    base = bool(
        finding.status == FindingStatus.CONFIRMED
        and finding.evidence_weight in REFERRAL_WEIGHTS
        and finding.overreach_reviewed
        and finding.document_links.exists()
    )
    if not base:
        return False
    if finding.gate_version == GateVersion.LEGACY_NARRATIVE:
        return True
    return finding_has_cited_assertion(finding) and finding_has_handoff_ready_assertion(finding)
