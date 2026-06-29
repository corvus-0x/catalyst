"""Regression tests for POST /api/cases/<uuid>/referral-pdf/.

The referral PDF is the product's deliverable — the citation-bearing package
handed to the AG/IRS/FBI. This endpoint previously 500'd on three invalid ORM
lookups (persondocument__/orgdocument__/finding_entities prefetch) that no
test covered; these tests pin the correct related names so it cannot silently
regress again.
"""

import io
from unittest.mock import patch

import fitz  # PyMuPDF — extract rendered PDF text for content assertions
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
    GateVersion,
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


def _pdf_text(response) -> str:
    """Extract all text from a PDF HTTP response for substring assertions.

    Substring assertions (not exact lines) are deliberate: PDF text extraction
    reorders/splits punctuation, so we assert stable fragments — headers, body
    text, filenames — never whole lines, and never raw bytes (the cover page
    embeds datetime.now()).
    """
    with fitz.open(stream=response.content, filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


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
            case=case,
            agency_name="Ohio AG",
            complaint_type="Charitable fraud",
        )
        f = Finding.objects.create(
            case=case,
            rule_id="MANUAL",
            title="Unreviewed",
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=False,
            narrative="n",
        )
        FindingDocument.objects.create(
            finding=f,
            document=Document.objects.create(
                case=case,
                filename="d.pdf",
                file_path="cases/t/d.pdf",
                sha256_hash="q" * 64,
                file_size=1024,
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
            case=case,
            agency_name="Ohio AG",
            complaint_type="Charitable fraud",
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
        FindingDocument.objects.create(
            finding=excluded, document=excluded_doc, page_reference="p. 1"
        )

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


class LegacyNarrativeRenderingTests(TestCase):
    """Phase 4C characterization: a LEGACY_NARRATIVE thread keeps rendering its
    grandfathered narrative + document citation. An explicit legacy fixture (not
    the ASSERTION_V1 setUp above) pins this so the Phase 2 extract-method refactor
    and the Phase 3 ASSERTION_V1 branch cannot silently regress the legacy path.
    """

    def setUp(self):
        self.client = Client(enforce_csrf_checks=False)
        self.case = Case.objects.create(name="Legacy Narrative Case")
        ReferralTarget.objects.create(
            case=self.case, agency_name="Ohio AG", complaint_type="Charitable fraud"
        )
        self.document = Document.objects.create(
            case=self.case,
            filename="legacy_deed.pdf",
            file_path="cases/doc/legacy_deed.pdf",
            sha256_hash="c" * 64,
            file_size=1024,
            doc_type=DocumentType.DEED,
            ocr_status=OcrStatus.COMPLETED,
        )
        self.finding = Finding.objects.create(
            case=self.case,
            rule_id="SR-025",
            title="Legacy False Disclosure",
            severity=Severity.CRITICAL,
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
            narrative="Disclosed zero related-party transactions despite the recorded deed.",
            gate_version=GateVersion.LEGACY_NARRATIVE,
        )
        FindingDocument.objects.create(
            finding=self.finding, document=self.document, page_reference="p. 4"
        )

    def _url(self) -> str:
        return reverse("api_case_referral_pdf", kwargs={"pk": self.case.pk})

    def test_legacy_finding_renders_narrative_and_document_citation(self):
        response = self.client.post(self._url())
        self.assertEqual(response.status_code, 200, response.content)
        text = _pdf_text(response)
        self.assertIn("Legacy False Disclosure", text)
        self.assertIn("Disclosed zero related-party transactions", text)
        self.assertIn("legacy_deed.pdf", text)

    def test_legacy_special_characters_do_not_crash_export(self):
        # User/system text with reportlab mini-HTML metachars must be escaped, not
        # passed raw to Paragraph() (which would raise and 500 the whole export).
        self.finding.title = "Smith & Jones <Holdings>"
        self.finding.narrative = "Diverted funds via A & B <shell> entities."
        self.finding.save(update_fields=["title", "narrative"])
        response = self.client.post(self._url())
        self.assertEqual(response.status_code, 200, response.content)
        text = _pdf_text(response)
        # PyMuPDF decodes entities, so the literal text round-trips.
        self.assertIn("Smith & Jones <Holdings>", text)
        self.assertIn("Diverted funds via A & B <shell> entities.", text)


class AssertionV1RenderingTests(TestCase):
    """Phase 4C-3/4: an ASSERTION_V1 thread renders structured assertions by
    derived evidentiary role — Documented Facts / Analysis / Referral Assertions /
    Open Questions — with per-assertion citations, NOTE + legacy narrative omitted,
    and no inline [Doc-N] tokens. This is the spec's acceptance bar.
    """

    def setUp(self):
        self.client = Client(enforce_csrf_checks=False)
        self.case = Case.objects.create(name="Assertion V1 Case")
        ReferralTarget.objects.create(
            case=self.case, agency_name="Ohio AG", complaint_type="Charitable fraud"
        )
        self.document = Document.objects.create(
            case=self.case,
            filename="bank_statement.pdf",
            file_path="cases/doc/bank_statement.pdf",
            sha256_hash="d" * 64,
            file_size=1024,
            doc_type=DocumentType.DEED,
            ocr_status=OcrStatus.COMPLETED,
        )
        self.finding = Finding.objects.create(
            case=self.case,
            rule_id="SR-028",
            title="Material Diversion",
            severity=Severity.CRITICAL,
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
            narrative="LEGACY NARRATIVE THAT MUST NOT APPEAR.",
            gate_version=GateVersion.ASSERTION_V1,
        )
        # Base predicate needs document_links > 0 even for ASSERTION_V1.
        FindingDocument.objects.create(
            finding=self.finding, document=self.document, page_reference="p. 2"
        )

        # 1) cited, non-handoff -> Documented Facts (also exercises [Doc-N] strip)
        fact = ThreadElement.objects.create(
            finding=self.finding,
            element_type=ThreadElementType.ASSERTION,
            text="Paid $50,000 to a related party. [Doc-9]",
            position=0,
            handoff_ready=False,
        )
        ThreadElementCitation.objects.create(
            element=fact,
            document=self.document,
            page_reference="Schedule L, line 2",
            context_note="related-party transfer",
        )
        # 2) uncited, non-handoff -> Analysis
        ThreadElement.objects.create(
            finding=self.finding,
            element_type=ThreadElementType.ASSERTION,
            text="The timing suggests coordination.",
            position=1,
            handoff_ready=False,
        )
        # 3) cited, handoff -> Referral Assertions (Documented)
        claim_cited = ThreadElement.objects.create(
            finding=self.finding,
            element_type=ThreadElementType.ASSERTION,
            text="The foundation diverted charitable assets.",
            position=2,
            handoff_ready=True,
        )
        ThreadElementCitation.objects.create(element=claim_cited, document=self.document)
        # 4) uncited, handoff -> Referral Assertions (Needs source)
        ThreadElement.objects.create(
            finding=self.finding,
            element_type=ThreadElementType.ASSERTION,
            text="Board members personally benefited.",
            position=3,
            handoff_ready=True,
        )
        # 5) QUESTION -> Open Questions
        ThreadElement.objects.create(
            finding=self.finding,
            element_type=ThreadElementType.QUESTION,
            text="Who authorized the wire transfer?",
            position=4,
        )
        # 6) NOTE -> omitted
        ThreadElement.objects.create(
            finding=self.finding,
            element_type=ThreadElementType.NOTE,
            text="Imported context note.",
            position=5,
        )

    def _text(self) -> str:
        response = self.client.post(reverse("api_case_referral_pdf", kwargs={"pk": self.case.pk}))
        self.assertEqual(response.status_code, 200, response.content)
        return _pdf_text(response)

    def test_renders_all_four_section_headers(self):
        text = self._text()
        self.assertIn("Documented Facts", text)
        self.assertIn("investigator interpretation", text)  # Analysis header
        self.assertIn("Referral Assertions", text)
        self.assertIn("Open Questions", text)

    def test_documented_fact_with_citation_and_verbatim_page_ref(self):
        text = self._text()
        self.assertIn("Paid $50,000 to a related party.", text)
        self.assertIn("bank_statement.pdf", text)
        self.assertIn("Schedule L, line 2", text)  # verbatim page_reference, no "p." prefix
        self.assertIn("related-party transfer", text)

    def test_analysis_assertion_rendered(self):
        self.assertIn("The timing suggests coordination.", self._text())

    def test_cited_handoff_is_documented_referral_assertion(self):
        text = self._text()
        self.assertIn("The foundation diverted charitable assets.", text)
        self.assertIn("Documented", text)

    def test_uncited_handoff_is_marked_needs_source(self):
        text = self._text()
        self.assertIn("Board members personally benefited.", text)
        self.assertIn("Needs source", text)

    def test_open_question_rendered(self):
        self.assertIn("Who authorized the wire transfer?", self._text())

    def test_note_and_legacy_narrative_omitted(self):
        text = self._text()
        self.assertNotIn("Imported context note.", text)
        self.assertNotIn("LEGACY NARRATIVE THAT MUST NOT APPEAR.", text)

    def test_no_doc_token_anywhere(self):
        self.assertNotIn("[Doc-", self._text())


class AssertionV1CitationFormattingTests(TestCase):
    """Citation-rendering edge cases: multiple citations on one assertion, a blank
    page_reference (no stray leading comma), and special chars in context_note
    (escaped end-to-end, no crash / no swallowed content)."""

    def setUp(self):
        self.client = Client(enforce_csrf_checks=False)
        self.case = Case.objects.create(name="Citation Formatting Case")
        ReferralTarget.objects.create(
            case=self.case, agency_name="Ohio AG", complaint_type="Charitable fraud"
        )
        self.doc_a = Document.objects.create(
            case=self.case,
            filename="alpha.pdf",
            file_path="cases/doc/alpha.pdf",
            sha256_hash="e" * 64,
            file_size=1024,
        )
        self.doc_b = Document.objects.create(
            case=self.case,
            filename="beta.pdf",
            file_path="cases/doc/beta.pdf",
            sha256_hash="f" * 64,
            file_size=1024,
        )
        self.finding = Finding.objects.create(
            case=self.case,
            rule_id="SR-028",
            title="Diversion",
            severity=Severity.CRITICAL,
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
            gate_version=GateVersion.ASSERTION_V1,
        )
        FindingDocument.objects.create(finding=self.finding, document=self.doc_a)

        # cited non-handoff fact with TWO citations (one rich, one blank page/context)
        fact = ThreadElement.objects.create(
            finding=self.finding,
            element_type=ThreadElementType.ASSERTION,
            text="Two corroborating documents.",
            position=0,
            handoff_ready=False,
        )
        ThreadElementCitation.objects.create(
            element=fact,
            document=self.doc_a,
            page_reference="Schedule L",
            context_note="Smith & Jones <holdings>",
        )
        ThreadElementCitation.objects.create(
            element=fact, document=self.doc_b, page_reference="", context_note=""
        )
        # handoff assertion to satisfy ASSERTION_V1 Tier-2
        ThreadElement.objects.create(
            finding=self.finding,
            element_type=ThreadElementType.ASSERTION,
            text="Headline referral assertion.",
            position=1,
            handoff_ready=True,
        )

    def _text(self) -> str:
        resp = self.client.post(reverse("api_case_referral_pdf", kwargs={"pk": self.case.pk}))
        self.assertEqual(resp.status_code, 200, resp.content)
        return _pdf_text(resp)

    def test_multiple_citations_both_render(self):
        text = self._text()
        self.assertIn("alpha.pdf", text)
        self.assertIn("beta.pdf", text)

    def test_rich_citation_shows_page_and_context(self):
        text = self._text()
        self.assertIn("alpha.pdf, Schedule L", text)  # verbatim page ref, no "p." prefix

    def test_blank_page_reference_has_no_trailing_comma(self):
        # beta.pdf citation has no page/context -> "• beta.pdf" with nothing after.
        self.assertNotIn("beta.pdf,", self._text())

    def test_context_note_special_chars_escaped_end_to_end(self):
        # & and <> in context_note must round-trip (escaped for reportlab, decoded
        # back by PyMuPDF) and must not crash or be swallowed.
        self.assertIn("Smith & Jones <holdings>", self._text())


class MixedGateVersionRenderingTests(TestCase):
    """A real post-4B case: one grandfathered LEGACY_NARRATIVE finding + one new
    ASSERTION_V1 finding in the same package. Both must render correctly without the
    legacy narrative bleeding into the structured sections."""

    def setUp(self):
        self.client = Client(enforce_csrf_checks=False)
        self.case = Case.objects.create(name="Mixed Gate Case")
        ReferralTarget.objects.create(
            case=self.case, agency_name="Ohio AG", complaint_type="Charitable fraud"
        )
        self.document = Document.objects.create(
            case=self.case,
            filename="shared.pdf",
            file_path="cases/doc/shared.pdf",
            sha256_hash="1" * 64,
            file_size=1024,
        )

        self.legacy = Finding.objects.create(
            case=self.case,
            rule_id="SR-025",
            title="Grandfathered Finding",
            severity=Severity.HIGH,
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
            narrative="Legacy narrative prose for the grandfathered thread.",
            gate_version=GateVersion.LEGACY_NARRATIVE,
        )
        FindingDocument.objects.create(finding=self.legacy, document=self.document)

        self.modern = Finding.objects.create(
            case=self.case,
            rule_id="SR-028",
            title="Structured Finding",
            severity=Severity.CRITICAL,
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
            gate_version=GateVersion.ASSERTION_V1,
        )
        FindingDocument.objects.create(finding=self.modern, document=self.document)
        cited = ThreadElement.objects.create(
            finding=self.modern,
            element_type=ThreadElementType.ASSERTION,
            text="A cited structured fact.",
            position=0,
            handoff_ready=False,
        )
        ThreadElementCitation.objects.create(element=cited, document=self.document)
        ThreadElement.objects.create(
            finding=self.modern,
            element_type=ThreadElementType.ASSERTION,
            text="A headline referral assertion.",
            position=1,
            handoff_ready=True,
        )

    def test_both_findings_render_in_one_package(self):
        resp = self.client.post(reverse("api_case_referral_pdf", kwargs={"pk": self.case.pk}))
        self.assertEqual(resp.status_code, 200, resp.content)
        text = _pdf_text(resp)
        # Legacy renders its narrative; modern renders structured sections.
        self.assertIn("Grandfathered Finding", text)
        self.assertIn("Legacy narrative prose for the grandfathered thread.", text)
        self.assertIn("Structured Finding", text)
        self.assertIn("Documented Facts", text)
        self.assertIn("A cited structured fact.", text)


class AssertionFindingEmptyBodyGuardTests(TestCase):
    """Defense-in-depth: an ASSERTION_V1 finding that maps to zero renderable
    sections (e.g. only NOTE elements) must not emit an orphan header. This state is
    gate-unreachable in production, so we exercise the renderer method directly."""

    def test_finding_with_only_note_elements_renders_nothing(self):
        case = Case.objects.create(name="Empty Body Case")
        finding = Finding.objects.create(
            case=case,
            rule_id="SR-028",
            title="Should Not Appear",
            severity=Severity.CRITICAL,
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
            gate_version=GateVersion.ASSERTION_V1,
        )
        ThreadElement.objects.create(
            finding=finding,
            element_type=ThreadElementType.NOTE,
            text="context only",
            position=0,
        )
        from ..referral_export import ReferralPDFGenerator

        story = ReferralPDFGenerator()._render_assertion_finding(1, finding)
        self.assertEqual(story, [])
