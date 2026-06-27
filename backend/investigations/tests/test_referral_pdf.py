"""Regression tests for POST /api/cases/<uuid>/referral-pdf/.

The referral PDF is the product's deliverable — the citation-bearing package
handed to the AG/IRS/FBI. This endpoint previously 500'd on three invalid ORM
lookups (persondocument__/orgdocument__/finding_entities prefetch) that no
test covered; these tests pin the correct related names so it cannot silently
regress again.
"""

import io
from unittest.mock import patch

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
    ThreadElement,
    ThreadElementCitation,
    ThreadElementType,
)


def _add_cited_handoff_assertion(finding, document):
    """Add a cited+handoff_ready assertion so a CONFIRMED finding meets ASSERTION_V1 Tier-2."""
    el = ThreadElement.objects.create(
        finding=finding,
        element_type=ThreadElementType.ASSERTION,
        text="Referral-grade assertion.",
        position=0,
        handoff_ready=True,
    )
    ThreadElementCitation.objects.create(element=el, document=document)


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
        _add_cited_handoff_assertion(self.finding, self.document)  # ASSERTION_V1 Tier-2

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

    def test_export_filter_excludes_overreach_unreviewed_from_partial_case(self):
        """Partial case: one referral-grade angle (Good) + one confirmed-but-not-referral-grade
        angle (overreach_reviewed=False). The case passes readiness (200), but the excluded
        angle must NOT appear in the findings passed to ReferralPDFGenerator.

        Patching investigations.referral_export.ReferralPDFGenerator because the view
        imports it locally as `from .referral_export import ReferralPDFGenerator` — the
        lookup happens in that module's namespace, not in views.
        """
        case = Case.objects.create(name="Partial PDF filter test")
        ReferralTarget.objects.create(
            case=case, agency_name="Ohio AG", complaint_type="Charitable fraud",
        )
        shared_doc = Document.objects.create(
            case=case,
            filename="evidence.pdf",
            file_path="cases/partial/evidence.pdf",
            sha256_hash="b" * 64,
            file_size=2048,
        )

        # Referral-grade angle: all criteria met (overreach_reviewed=True, cited)
        good = Finding.objects.create(
            case=case,
            rule_id="SR-015",
            title="Good",
            severity=Severity.CRITICAL,
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
            narrative="This angle passes all referral-grade criteria.",
        )
        FindingDocument.objects.create(finding=good, document=shared_doc, page_reference="p. 1")
        _add_cited_handoff_assertion(good, shared_doc)  # ASSERTION_V1 Tier-2

        # Confirmed + documented + cited but overreach_reviewed=False — must be excluded
        excluded_doc = Document.objects.create(
            case=case,
            filename="excluded.pdf",
            file_path="cases/partial/excluded.pdf",
            sha256_hash="c" * 64,
            file_size=1024,
        )
        excluded = Finding.objects.create(
            case=case,
            rule_id="MANUAL",
            title="Excluded",
            severity=Severity.CRITICAL,
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=False,
            narrative="Overreach not reviewed — must not appear in the referral package.",
        )
        FindingDocument.objects.create(finding=excluded, document=excluded_doc, page_reference="p. 1")

        with patch("investigations.referral_export.ReferralPDFGenerator") as MockGen:
            instance = MockGen.return_value
            instance.generate.return_value = io.BytesIO(b"%PDF-1.4 fake")
            resp = self.client.post(f"/api/cases/{case.pk}/referral-pdf/")

        self.assertEqual(resp.status_code, 200, resp.content)
        # Confirm the mock was actually called — if not, the patch target is wrong
        self.assertTrue(instance.generate.called, "ReferralPDFGenerator.generate was not called")

        # Inspect the findings queryset passed to the generator
        passed = list(instance.generate.call_args.kwargs["findings"])
        titles = {f.title for f in passed}
        self.assertIn("Good", titles, "Referral-grade angle should be included")
        self.assertNotIn("Excluded", titles, "overreach_reviewed=False angle must be excluded")
