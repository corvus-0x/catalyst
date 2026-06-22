from django.test import TestCase

from investigations.models import (
    Case,
    Document,
    Finding,
    FindingDocument,
    ThreadElement,
    ThreadElementCitation,
    ThreadElementType,
)


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class ThreadElementApiTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.f = Finding.objects.create(case=self.case, rule_id="MANUAL", title="T")
        self.base = f"/api/cases/{self.case.pk}/findings/{self.f.pk}/elements/"

    def test_create_and_list(self):
        r = self.client.post(
            self.base,
            data={"element_type": "ASSERTION", "text": "x"},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        listing = self.client.get(self.base).json()
        self.assertEqual(len(listing["results"]), 1)
        self.assertEqual(listing["count"], 1)

    def test_reorder_rejects_non_list_ordered_ids(self):
        ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.ASSERTION, position=0
        )
        r = self.client.post(
            self.base + "reorder/",
            data={"ordered_ids": None},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("ordered_ids", r.json()["errors"])

    def test_reorder_atomic(self):
        a = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.ASSERTION, position=0
        )
        b = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.QUESTION, position=1
        )
        r = self.client.post(
            self.base + "reorder/",
            data={"ordered_ids": [str(b.id), str(a.id)]},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertEqual((b.position, a.position), (0, 1))

    def test_add_then_delete_citation_syncs_document_links(self):
        el = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.ASSERTION, position=0
        )
        doc = _doc(self.case)
        r = self.client.post(
            f"{self.base}{el.id}/citations/",
            data={"document_id": str(doc.id)},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(FindingDocument.objects.filter(finding=self.f, document=doc).exists())
        cite = ThreadElementCitation.objects.get(element=el, document=doc)
        r2 = self.client.delete(f"{self.base}{el.id}/citations/{cite.id}/")
        self.assertEqual(r2.status_code, 204)
        self.assertFalse(FindingDocument.objects.filter(finding=self.f, document=doc).exists())

    def test_delete_element_reaps_orphan_link(self):
        el = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.ASSERTION, position=0
        )
        doc = _doc(self.case)
        el.citations.create(document=doc)
        FindingDocument.objects.create(finding=self.f, document=doc)
        r = self.client.delete(f"{self.base}{el.id}/")
        self.assertEqual(r.status_code, 204)
        self.assertFalse(FindingDocument.objects.filter(finding=self.f).exists())
