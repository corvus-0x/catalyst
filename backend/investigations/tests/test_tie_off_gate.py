from django.test import TestCase

from investigations.models import (
    Case,
    Document,
    EvidenceWeight,
    Finding,
    FindingDocument,
    FindingStatus,
    GateVersion,
    ThreadElement,
    ThreadElementCitation,
    ThreadElementType,
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
        # Default gate_version is ASSERTION_V1 — "cited_assertion" replaces "narrative".
        f = self._new_finding(status=FindingStatus.NEW)
        s = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=f)
        self.assertFalse(s.is_valid())
        self.assertEqual(
            sorted(s.errors["gate"]["unmet"]),
            ["citation", "cited_assertion", "evidence_weight", "overreach"],
        )

    def test_confirm_with_all_conditions_in_one_payload(self):
        f = self._new_finding(status=FindingStatus.NEW)
        doc = _document(self.case)
        # ASSERTION_V1 requires a cited assertion; add one before the confirm call.
        _cited_assertion(f, self.case)
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
        s = FindingUpdateSerializer(data={"remove_document_ids": [str(doc.id)]}, instance=f)
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

    def test_confirm_emits_signal_confirmed_audit_row(self):
        from investigations.models import AuditAction, AuditLog

        f = self._new_finding(status=FindingStatus.NEW)
        doc = _document(self.case)
        FindingDocument.objects.create(finding=f, document=doc)
        # ASSERTION_V1 requires a cited assertion for the gate to pass.
        _cited_assertion(f, self.case)
        resp = self.client.patch(
            f"/api/cases/{self.case.pk}/findings/{f.pk}/",
            data={
                "status": "CONFIRMED",
                "evidence_weight": "DOCUMENTED",
                "narrative": "n",
                "overreach_reviewed": True,
            },
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(
            AuditLog.objects.filter(
                case_id=self.case.pk,
                record_id=f.pk,
                action=AuditAction.SIGNAL_CONFIRMED,
            ).exists()
        )

    def test_http_gate_blocks_confirm_with_no_conditions_met(self):
        """PATCH to CONFIRMED with nothing met must return 400 with the full gate envelope."""
        f = self._new_finding(status=FindingStatus.NEW)
        resp = self.client.patch(
            f"/api/cases/{self.case.pk}/findings/{f.pk}/",
            data={"status": "CONFIRMED"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)
        unmet = resp.json()["errors"]["gate"]["unmet"]
        self.assertIn("citation", unmet)
        self.assertIn("evidence_weight", unmet)
        # Default gate_version is ASSERTION_V1 — cited_assertion replaces narrative.
        self.assertIn("cited_assertion", unmet)
        self.assertIn("overreach", unmet)
        self.assertEqual(
            sorted(unmet),
            ["citation", "cited_assertion", "evidence_weight", "overreach"],
        )

    def test_dismiss_emits_signal_dismissed_audit_row(self):
        """PATCH to DISMISSED with a rationale must emit a SIGNAL_DISMISSED audit row."""
        from investigations.models import AuditAction, AuditLog

        f = self._new_finding(status=FindingStatus.NEW)
        resp = self.client.patch(
            f"/api/cases/{self.case.pk}/findings/{f.pk}/",
            data={
                "status": "DISMISSED",
                "investigator_note": "Lead did not pan out — no corroborating records found.",
            },
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(
            AuditLog.objects.filter(
                case_id=self.case.pk,
                record_id=f.pk,
                action=AuditAction.SIGNAL_DISMISSED,
            ).exists()
        )


def _cited_assertion(finding, case):
    doc = Document.objects.create(
        case=case,
        filename="e.pdf",
        file_path="cases/t/e.pdf",
        sha256_hash="e" * 64,
        file_size=10,
    )
    el = ThreadElement.objects.create(
        finding=finding,
        element_type=ThreadElementType.ASSERTION,
        text="The charity paid $500k to an insider LLC.",
        position=0,
    )
    ThreadElementCitation.objects.create(element=el, document=doc, context_note="p.3")
    # The bare citation create does NOT sync document_links — add the compat row the
    # tie-off gate's post_docs check reads (mirrors ensure_document_link).
    FindingDocument.objects.get_or_create(finding=finding, document=doc)
    return el


class AssertionV1TieOffTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="AV1")
        self.f = Finding.objects.create(
            case=self.case,
            rule_id="MANUAL",
            title="A",
            status=FindingStatus.NEW,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
            gate_version=GateVersion.ASSERTION_V1,
        )

    def test_assertion_v1_confirm_blocked_without_cited_assertion(self):
        ser = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=self.f)
        self.assertFalse(ser.is_valid())
        self.assertIn("cited_assertion", ser._errors["gate"]["unmet"])

    def test_assertion_v1_confirm_allowed_with_cited_assertion(self):
        _cited_assertion(self.f, self.case)
        ser = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=self.f)
        self.assertTrue(ser.is_valid(), ser._errors)

    def test_assertion_v1_narrative_alone_does_not_satisfy(self):
        self.f.narrative = "prose only, no assertions"
        self.f.save(update_fields=["narrative"])
        ser = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=self.f)
        self.assertFalse(ser.is_valid())
        self.assertIn("cited_assertion", ser._errors["gate"]["unmet"])

    def test_legacy_narrative_confirm_uses_old_narrative_check(self):
        self.f.gate_version = GateVersion.LEGACY_NARRATIVE
        self.f.narrative = "legacy prose"
        self.f.save(update_fields=["gate_version", "narrative"])
        # legacy still needs a doc link; add one the way the file's other tests do
        # (FindingDocument), then confirm passes without any assertion.
        FindingDocument.objects.create(
            finding=self.f,
            document=Document.objects.create(
                case=self.case,
                filename="L.pdf",
                file_path="cases/t/L.pdf",
                sha256_hash="d" * 64,
                file_size=10,
            ),
        )
        ser = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=self.f)
        self.assertTrue(ser.is_valid(), ser._errors)

    def test_no_regate_on_edit_of_confirmed(self):
        self.f.status = FindingStatus.CONFIRMED
        self.f.save(update_fields=["status"])
        ser = FindingUpdateSerializer(
            data={"status": "CONFIRMED", "title": "edited"}, instance=self.f
        )
        self.assertTrue(ser.is_valid(), ser._errors)
