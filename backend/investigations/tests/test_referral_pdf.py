"""Regression tests for POST /api/cases/<uuid>/referral-pdf/.

The referral PDF is the product's deliverable — the citation-bearing package
handed to the AG/IRS/FBI. This endpoint previously 500'd on three invalid ORM
lookups (persondocument__/orgdocument__/finding_entities prefetch) that no
test covered; these tests pin the correct related names so it cannot silently
regress again.
"""

from django.test import Client, TestCase
from django.urls import reverse

from ..models import (
    Case,
    Document,
    DocumentType,
    EvidenceWeight,
    Finding,
    FindingDocument,
    FindingEntity,
    FindingStatus,
    OcrStatus,
    Organization,
    OrgDocument,
    Person,
    PersonDocument,
    ReferralTarget,
    Severity,
)


class ReferralPdfTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=False)
        self.case = Case.objects.create(name="Referral PDF Test Case")
        self.document = Document.objects.create(
            case=self.case,
            filename="deed_2019.pdf",
            file_path="cases/doc/deed_2019.pdf",
            sha256_hash="a" * 64,
            file_size=2048,
            doc_type=DocumentType.DEED,
            ocr_status=OcrStatus.COMPLETED,
        )
        self.person = Person.objects.create(case=self.case, full_name="Sarah Example")
        self.org = Organization.objects.create(case=self.case, name="Example Foundation")
        ReferralTarget.objects.create(
            case=self.case,
            agency_name="Ohio AG",
            complaint_type="Charitable fraud",
        )
        # Entity↔document links exercise the document_links reverse lookups
        # that the view filters on (the original bug used persondocument__/
        # orgdocument__, which do not exist).
        PersonDocument.objects.create(person=self.person, document=self.document)
        OrgDocument.objects.create(org=self.org, document=self.document)

        self.finding = Finding.objects.create(
            case=self.case,
            rule_id="SR-015",
            title="Insider Property Swap",
            severity=Severity.CRITICAL,
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
            narrative="Related party on both sides of the transaction.",
        )
        FindingEntity.objects.create(
            finding=self.finding,
            entity_id=self.person.pk,
            entity_type="person",
            context_note="Buyer",
        )
        FindingDocument.objects.create(
            finding=self.finding,
            document=self.document,
            page_reference="p. 1",
        )

    def _url(self) -> str:
        return reverse("api_case_referral_pdf", kwargs={"pk": self.case.pk})

    def test_returns_pdf_for_case_with_confirmed_findings(self):
        response = self.client.post(self._url())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(
            response.content.startswith(b"%PDF-"),
            "Response body should be a PDF stream",
        )
        self.assertIn("attachment", response["Content-Disposition"])

    def test_blocks_pdf_for_empty_case(self):
        empty_case = Case.objects.create(name="Empty Case")
        url = reverse("api_case_referral_pdf", kwargs={"pk": empty_case.pk})
        response = self.client.post(url)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["readiness"]["status"], "BLOCKED")

    def test_404_on_missing_case(self):
        url = reverse(
            "api_case_referral_pdf",
            kwargs={"pk": "00000000-0000-0000-0000-000000000000"},
        )
        response = self.client.post(url)
        self.assertEqual(response.status_code, 404)

    def test_pdf_excludes_overreach_unreviewed_confirmed(self):
        # A confirmed, documented, cited angle that is NOT overreach-reviewed
        # must not appear in the package (and must not satisfy readiness alone).
        case = Case.objects.create(name="PDF excl")
        ReferralTarget.objects.create(
            case=case, agency_name="Ohio AG", complaint_type="Charitable fraud",
        )
        f = Finding.objects.create(
            case=case, rule_id="MANUAL", title="Unreviewed",
            status=FindingStatus.CONFIRMED, evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=False, narrative="n",
        )
        FindingDocument.objects.create(
            finding=f,
            document=Document.objects.create(
                case=case, filename="d.pdf", file_path="cases/t/d.pdf",
                sha256_hash="q" * 64, file_size=1024,
            ),
        )
        resp = self.client.post(f"/api/cases/{case.pk}/referral-pdf/")
        # Zero referral-grade angles => readiness BLOCKED => 400.
        self.assertEqual(resp.status_code, 400, resp.content)
