"""Single source of truth for the referral-grade predicate.

An Angle (Finding) is "referral-grade" iff it is CONFIRMED, has at least one
cited document, has evidence weight DOCUMENTED or TRACED, and
`overreach_reviewed` is True on the finding. Used by readiness, the
credibility counts, and the referral PDF filter so the definition never drifts.
"""

from django.db.models import Count

from .models import EvidenceWeight, Finding, FindingStatus

REFERRAL_WEIGHTS = [EvidenceWeight.DOCUMENTED, EvidenceWeight.TRACED]


def referral_grade_qs(case):
    """Queryset of referral-grade Angles for a case (a single SQL statement)."""
    return (
        Finding.objects.filter(
            case=case,
            status=FindingStatus.CONFIRMED,
            evidence_weight__in=REFERRAL_WEIGHTS,
            overreach_reviewed=True,
        )
        .annotate(_citation_count=Count("document_links"))
        .filter(_citation_count__gt=0)
    )


def is_referral_grade(finding) -> bool:
    """True iff a single Finding instance meets every referral-grade condition."""
    return bool(
        finding.status == FindingStatus.CONFIRMED
        and finding.evidence_weight in REFERRAL_WEIGHTS
        and finding.overreach_reviewed
        and finding.document_links.exists()
    )
