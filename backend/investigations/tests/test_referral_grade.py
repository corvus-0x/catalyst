# backend/investigations/tests/test_referral_grade.py
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
from investigations.referral_grade import is_referral_grade, referral_grade_qs


def _document(case, suffix="a"):
    return Document.objects.create(
        case=case,
        filename=f"evidence-{suffix}.pdf",
        file_path=f"cases/test/evidence-{suffix}.pdf",
        sha256_hash=suffix * 64,
        file_size=1024,
    )


def _cited_handoff_assertion(finding, case, suffix="a"):
    """One assertion that is BOTH cited and handoff_ready (satisfies both Tier-2 legs)."""
    doc = _document(case, suffix)
    FindingDocument.objects.create(finding=finding, document=doc)  # compat index row
    el = ThreadElement.objects.create(
        finding=finding,
        element_type=ThreadElementType.ASSERTION,
        text="Insider payment of $500k.",
        position=0,
        handoff_ready=True,
    )
    ThreadElementCitation.objects.create(element=el, document=doc, context_note="p.3")
    return el


class ReferralGradeTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")

    def _confirmed(self, **kw):
        defaults = dict(
            case=self.case,
            rule_id="MANUAL",
            title="A",
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
        )
        defaults.update(kw)
        return Finding.objects.create(**defaults)

    # --- ASSERTION_V1 (default) ---
    def test_v1_cited_handoff_assertion_is_grade(self):
        f = self._confirmed()  # gate_version defaults to ASSERTION_V1
        _cited_handoff_assertion(f, self.case)
        self.assertTrue(is_referral_grade(f))
        self.assertEqual(referral_grade_qs(self.case).count(), 1)

    def test_v1_doc_only_is_not_grade(self):
        f = self._confirmed()
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertFalse(is_referral_grade(f))
        self.assertEqual(referral_grade_qs(self.case).count(), 0)

    def test_v1_cited_but_no_handoff_is_not_grade(self):
        f = self._confirmed()
        doc = _document(self.case)
        FindingDocument.objects.create(finding=f, document=doc)
        el = ThreadElement.objects.create(
            finding=f,
            element_type=ThreadElementType.ASSERTION,
            text="cited only",
            position=0,
        )
        ThreadElementCitation.objects.create(element=el, document=doc)
        self.assertFalse(is_referral_grade(f))
        self.assertEqual(referral_grade_qs(self.case).count(), 0)

    def test_v1_empty_text_assertion_excluded_by_both_predicates(self):
        """Parity: an ASSERTION with empty text must be excluded by both is_referral_grade()
        and referral_grade_qs() even when handoff_ready=True and a citation + FindingDocument exist."""
        f = self._confirmed()
        doc = _document(self.case, suffix="e")
        FindingDocument.objects.create(finding=f, document=doc)
        el = ThreadElement.objects.create(
            finding=f,
            element_type=ThreadElementType.ASSERTION,
            text="",
            position=0,
            handoff_ready=True,
        )
        ThreadElementCitation.objects.create(element=el, document=doc, context_note="p.1")
        self.assertFalse(is_referral_grade(f))
        self.assertNotIn(
            f.id,
            referral_grade_qs(self.case).values_list("id", flat=True),
        )

    # --- LEGACY_NARRATIVE (grandfathered) ---
    def test_legacy_doc_only_is_grade(self):
        f = self._confirmed(gate_version=GateVersion.LEGACY_NARRATIVE)
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertTrue(is_referral_grade(f))
        self.assertEqual(referral_grade_qs(self.case).count(), 1)

    def test_legacy_overreach_false_not_grade(self):
        f = self._confirmed(
            gate_version=GateVersion.LEGACY_NARRATIVE,
            overreach_reviewed=False,
        )
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertFalse(is_referral_grade(f))

    # --- parity: instance predicate <=> queryset membership ---
    def test_parity_across_versions(self):
        cases = [
            self._confirmed(),  # v1, nothing -> not grade
            self._confirmed(
                gate_version=GateVersion.LEGACY_NARRATIVE
            ),  # legacy, no doc -> not grade
        ]
        g1 = self._confirmed()
        _cited_handoff_assertion(g1, self.case, suffix="b")
        g2 = self._confirmed(gate_version=GateVersion.LEGACY_NARRATIVE)
        FindingDocument.objects.create(finding=g2, document=_document(self.case, suffix="c"))
        cases += [g1, g2]
        qs_ids = set(referral_grade_qs(self.case).values_list("id", flat=True))
        for f in cases:
            self.assertEqual(is_referral_grade(f), f.id in qs_ids, f"mismatch for {f.id}")
