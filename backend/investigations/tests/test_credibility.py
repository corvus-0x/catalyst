from django.test import TestCase

from investigations.models import (
    Case,
    Document,
    EvidenceWeight,
    Finding,
    FindingDocument,
    FindingStatus,
    ThreadElement,
    ThreadElementCitation,
    ThreadElementType,
)
from investigations.views import build_case_readiness, build_credibility


def _grade(case, **kw):
    """Create a CONFIRMED finding that satisfies the ASSERTION_V1 referral-grade predicate.

    Referral-grade under ASSERTION_V1 requires:
      - status=CONFIRMED, evidence_weight ∈ {DOCUMENTED,TRACED}, overreach_reviewed=True
      - ≥1 cited assertion  (for the tie-off gate)
      - ≥1 handoff_ready assertion  (for the Tier-2 referral-grade predicate)
    One cited + handoff_ready ASSERTION satisfies both legs.
    """
    import hashlib

    f = Finding.objects.create(
        case=case,
        rule_id="MANUAL",
        title="A",
        status=FindingStatus.CONFIRMED,
        evidence_weight=EvidenceWeight.DOCUMENTED,
        overreach_reviewed=True,
        narrative="n",
        **kw,
    )
    sha = hashlib.sha256(f"grade-{f.pk}".encode()).hexdigest()
    doc = Document.objects.create(
        case=case,
        filename=f"grade-{f.pk}.pdf",
        file_path=f"cases/t/grade-{f.pk}.pdf",
        sha256_hash=sha,
        file_size=1024,
    )
    FindingDocument.objects.create(finding=f, document=doc)
    el = ThreadElement.objects.create(
        finding=f,
        element_type=ThreadElementType.ASSERTION,
        text="Substantiated assertion supporting referral.",
        position=0,
        handoff_ready=True,
    )
    ThreadElementCitation.objects.create(element=el, document=doc, context_note="p.1")
    return f


class CredibilityTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")

    def test_triplet_counts(self):
        _grade(self.case)  # referral-grade
        Finding.objects.create(
            case=self.case, rule_id="MANUAL", title="N", status=FindingStatus.NEW
        )
        # confirmed-but-unmet (overreach False) counts as need-work, not referral-grade
        Finding.objects.create(
            case=self.case,
            rule_id="MANUAL",
            title="U",
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=False,
        )
        c = build_credibility(self.case)
        self.assertEqual(c["referral_grade"], 1)
        self.assertEqual(c["need_work"], 2)
        self.assertEqual(c["agency_leads"], 0)

    def test_readiness_blocked_and_names_overreach_when_only_unreviewed_confirmed(self):
        # Confirmed + cited + documented but overreach NOT reviewed: one ack away.
        f = Finding.objects.create(
            case=self.case,
            rule_id="MANUAL",
            title="U",
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=False,
            narrative="n",
        )
        FindingDocument.objects.create(
            finding=f,
            document=Document.objects.create(
                case=self.case,
                filename="d.pdf",
                file_path="cases/t/d.pdf",
                sha256_hash="w" * 64,
                file_size=1024,
            ),
        )
        readiness = build_case_readiness(self.case)
        self.assertEqual(readiness["status"], "BLOCKED")
        self.assertEqual(readiness["credibility"]["referral_grade"], 0)
        # The missing condition is named, not hidden behind the generic FAIL.
        by_key = {item["key"]: item for item in readiness["items"]}
        self.assertEqual(by_key["overreach_review"]["status"], "WARN")
