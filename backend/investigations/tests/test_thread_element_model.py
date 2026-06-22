from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.test import TestCase

from investigations.models import (
    Case,
    Document,
    Finding,
    FindingDocument,
    GateVersion,
    ThreadElement,
    ThreadElementCitation,
    ThreadElementType,
)


def _doc(case, suffix="a"):
    return Document.objects.create(
        case=case,
        filename=f"e-{suffix}.pdf",
        file_path=f"c/e-{suffix}.pdf",
        sha256_hash=suffix * 64,
        file_size=10,
    )


class ThreadElementModelTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.finding = Finding.objects.create(case=self.case, rule_id="MANUAL", title="T")

    def test_create_and_order_by_position(self):
        ThreadElement.objects.create(
            finding=self.finding, element_type=ThreadElementType.QUESTION, position=1
        )
        ThreadElement.objects.create(
            finding=self.finding, element_type=ThreadElementType.ASSERTION, position=0
        )
        types = list(self.finding.elements.values_list("element_type", flat=True))
        self.assertEqual(types, ["ASSERTION", "QUESTION"])

    def test_unique_position_per_finding(self):
        ThreadElement.objects.create(
            finding=self.finding, element_type=ThreadElementType.ASSERTION, position=0
        )
        with self.assertRaises(IntegrityError):
            ThreadElement.objects.create(
                finding=self.finding, element_type=ThreadElementType.QUESTION, position=0
            )

    def test_citation_same_case_clean_passes(self):
        el = ThreadElement.objects.create(
            finding=self.finding, element_type=ThreadElementType.ASSERTION, position=0
        )
        c = ThreadElementCitation(element=el, document=_doc(self.case))
        c.full_clean()
        c.save()
        self.assertEqual(el.citations.count(), 1)

    def test_citation_cross_case_clean_raises(self):
        el = ThreadElement.objects.create(
            finding=self.finding, element_type=ThreadElementType.ASSERTION, position=0
        )
        c = ThreadElementCitation(element=el, document=_doc(Case.objects.create(name="O"), "b"))
        with self.assertRaises(ValidationError):
            c.full_clean()

    def test_finding_gate_version_defaults_assertion_v1(self):
        self.assertEqual(self.finding.gate_version, GateVersion.ASSERTION_V1)

    def test_finding_document_is_legacy_defaults_false(self):
        fd = FindingDocument.objects.create(finding=self.finding, document=_doc(self.case, "c"))
        self.assertFalse(fd.is_legacy)
