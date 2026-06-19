from django.test import TestCase
from investigations.models import (
    Case, Document, Finding, FindingDocument, FindingStatus, EvidenceWeight,
)
from investigations.serializers import FindingUpdateSerializer


def _document(case, suffix="a"):
    return Document.objects.create(
        case=case,
        filename=f"evidence-{suffix}.pdf",
        file_path=f"cases/test/evidence-{suffix}.pdf",
        sha256_hash=suffix * 64,
        file_size=1024,
    )


class TieOffGateTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="G")

    def _new_finding(self, **kw):
        return Finding.objects.create(case=self.case, rule_id="MANUAL", title="A", **kw)

    def test_confirm_with_nothing_lists_all_unmet(self):
        f = self._new_finding(status=FindingStatus.NEW)
        s = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=f)
        self.assertFalse(s.is_valid())
        self.assertEqual(
            sorted(s.errors["gate"]["unmet"]),
            ["citation", "evidence_weight", "narrative", "overreach"],
        )

    def test_confirm_with_all_conditions_in_one_payload(self):
        f = self._new_finding(status=FindingStatus.NEW)
        doc = _document(self.case)
        s = FindingUpdateSerializer(
            data={
                "status": "CONFIRMED",
                "evidence_weight": "DOCUMENTED",
                "narrative": "Cited and substantiated.",
                "overreach_reviewed": True,
                "add_document_ids": [str(doc.id)],
            },
            instance=f,
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_editing_already_confirmed_angle_does_not_re_gate(self):
        # Condition loss is allowed: removing the last citation from a confirmed
        # angle succeeds (it just stops being referral-grade).
        f = self._new_finding(
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            narrative="n",
            overreach_reviewed=True,
        )
        doc = _document(self.case)
        FindingDocument.objects.create(finding=f, document=doc)
        s = FindingUpdateSerializer(
            data={"remove_document_ids": [str(doc.id)]}, instance=f
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_idempotent_reconfirm_when_still_grade(self):
        f = self._new_finding(
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.TRACED,
            narrative="n",
            overreach_reviewed=True,
        )
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        s = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=f)
        self.assertTrue(s.is_valid(), s.errors)
