from django.test import TestCase

from investigations.models import (
    Case,
    Document,
    Finding,
    FindingDocument,
    ThreadElement,
    ThreadElementType,
)
from investigations.thread_elements import ensure_document_link, reap_document_link_if_orphaned


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class DocumentLinkSyncTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.f = Finding.objects.create(case=self.case, rule_id="MANUAL", title="T")
        self.doc = _doc(self.case)

    def test_ensure_creates_one_non_legacy_link(self):
        ensure_document_link(self.f, self.doc)
        ensure_document_link(self.f, self.doc)
        links = FindingDocument.objects.filter(finding=self.f, document=self.doc)
        self.assertEqual(links.count(), 1)
        self.assertFalse(links.first().is_legacy)

    def test_reap_removes_when_no_element_cites(self):
        ensure_document_link(self.f, self.doc)
        reap_document_link_if_orphaned(self.f, self.doc)
        self.assertEqual(
            FindingDocument.objects.filter(finding=self.f, document=self.doc).count(), 0
        )

    def test_reap_keeps_when_another_element_still_cites(self):
        el = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.ASSERTION, position=0
        )
        el.citations.create(document=self.doc)
        ensure_document_link(self.f, self.doc)
        reap_document_link_if_orphaned(self.f, self.doc)
        self.assertEqual(
            FindingDocument.objects.filter(finding=self.f, document=self.doc).count(), 1
        )

    def test_reap_never_removes_legacy(self):
        FindingDocument.objects.create(finding=self.f, document=self.doc, is_legacy=True)
        reap_document_link_if_orphaned(self.f, self.doc)
        self.assertEqual(
            FindingDocument.objects.filter(finding=self.f, document=self.doc).count(), 1
        )
