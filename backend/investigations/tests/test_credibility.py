from django.test import TestCase

from investigations.models import (
    Case,
    Document,
    Finding,
    FindingDocument,
    FindingStatus,
    EvidenceWeight,
)
from investigations.views import build_case_readiness, build_credibility


def _grade(case, **kw):
    f = Finding.objects.create(
        case=case, rule_id="MANUAL", title="A",
        status=FindingStatus.CONFIRMED, evidence_weight=EvidenceWeight.DOCUMENTED,
        overreach_reviewed=True, narrative="n", **kw,
    )
    FindingDocument.objects.create(
        finding=f,
        document=Document.objects.create(
            case=case, filename="d.pdf", file_path="cases/t/d.pdf",
            sha256_hash="z" * 64, file_size=1024,
        ),
    )
    return f


class CredibilityTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")

    def test_triplet_counts(self):
        _grade(self.case)  # referral-grade
        Finding.objects.create(case=self.case, rule_id="MANUAL", title="N", status=FindingStatus.NEW)
        # confirmed-but-unmet (overreach False) counts as need-work, not referral-grade
        Finding.objects.create(
            case=self.case, rule_id="MANUAL", title="U",
            status=FindingStatus.CONFIRMED, evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=False,
        )
        c = build_credibility(self.case)
        self.assertEqual(c["referral_grade"], 1)
        self.assertEqual(c["need_work"], 2)
        self.assertEqual(c["agency_leads"], 0)

    def test_readiness_blocked_and_names_overreach_when_only_unreviewed_confirmed(self):
        # Confirmed + cited + documented but overreach NOT reviewed: one ack away.
        f = Finding.objects.create(
            case=self.case, rule_id="MANUAL", title="U",
            status=FindingStatus.CONFIRMED, evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=False, narrative="n",
        )
        FindingDocument.objects.create(
            finding=f,
            document=Document.objects.create(
                case=self.case, filename="d.pdf", file_path="cases/t/d.pdf",
                sha256_hash="w" * 64, file_size=1024,
            ),
        )
        readiness = build_case_readiness(self.case)
        self.assertEqual(readiness["status"], "BLOCKED")
        self.assertEqual(readiness["credibility"]["referral_grade"], 0)
        # The missing condition is named, not hidden behind the generic FAIL.
        by_key = {item["key"]: item for item in readiness["items"]}
        self.assertEqual(by_key["overreach_review"]["status"], "WARN")
