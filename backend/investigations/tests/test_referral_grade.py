# backend/investigations/tests/test_referral_grade.py
from django.test import TestCase
from investigations.models import (
    Case, Document, Finding, FindingDocument, FindingStatus, EvidenceWeight,
)
from investigations.referral_grade import is_referral_grade, referral_grade_qs


def _document(case, suffix="a"):
    # Document requires file_path, sha256_hash, file_size (NOT `sha256`).
    return Document.objects.create(
        case=case,
        filename=f"evidence-{suffix}.pdf",
        file_path=f"cases/test/evidence-{suffix}.pdf",
        sha256_hash=suffix * 64,
        file_size=1024,
    )


class ReferralGradeTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")

    def _confirmed(self, **kw):
        defaults = dict(
            case=self.case, rule_id="MANUAL", title="A",
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
        )
        defaults.update(kw)
        f = Finding.objects.create(**defaults)
        return f

    def test_full_predicate_is_grade(self):
        f = self._confirmed()
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertTrue(is_referral_grade(f))
        self.assertEqual(referral_grade_qs(self.case).count(), 1)

    def test_missing_citation_not_grade(self):
        f = self._confirmed()
        self.assertFalse(is_referral_grade(f))
        self.assertEqual(referral_grade_qs(self.case).count(), 0)

    def test_overreach_false_not_grade(self):
        f = self._confirmed(overreach_reviewed=False)
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertFalse(is_referral_grade(f))

    def test_weak_weight_not_grade(self):
        f = self._confirmed(evidence_weight=EvidenceWeight.SPECULATIVE)
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertFalse(is_referral_grade(f))
