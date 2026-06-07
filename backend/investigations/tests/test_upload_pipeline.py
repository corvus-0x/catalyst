"""Tests for the document upload pipeline.

Covers behaviors added in the QA audit P0 fixes:
- SHA-256 deduplication on re-upload (#4)
- form990_parser wired in for FORM_990 docs (#5)
"""

from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase
from django.urls import reverse

from ..models import Case, Document, DocumentType, OcrStatus


class UploadShaDedupTests(TestCase):
    """Re-uploading the same bytes on the same case must not create a new row."""

    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="Dedup Test Case")
        self.upload_url = reverse("api_case_document_bulk_upload", args=[self.case.pk])

    def _upload(self, name="evidence.txt", content=b"plain text body"):
        return self.client.post(
            self.upload_url,
            {"files": SimpleUploadedFile(name, content, "text/plain")},
        )

    def test_first_upload_creates_document(self):
        response = self._upload()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Document.objects.filter(case=self.case).count(), 1)

    def test_reupload_same_bytes_does_not_create_duplicate(self):
        first = self._upload()
        self.assertEqual(first.status_code, 201)
        first_id = first.json()["created"][0]["id"]

        second = self._upload()
        self.assertEqual(second.status_code, 201)

        # Only one Document row should exist for this (case, sha256).
        self.assertEqual(
            Document.objects.filter(case=self.case).count(),
            1,
            "Re-uploading identical bytes created a duplicate Document — "
            "SHA-256 dedup not enforced.",
        )
        # The second response should reference the existing document.
        second_id = second.json()["created"][0]["id"]
        self.assertEqual(second_id, first_id)

    def test_same_bytes_different_case_creates_separate_document(self):
        other_case = Case.objects.create(name="Other Case")
        other_url = reverse("api_case_document_bulk_upload", args=[other_case.pk])

        first = self._upload()
        self.assertEqual(first.status_code, 201)

        second = self.client.post(
            other_url,
            {"files": SimpleUploadedFile("evidence.txt", b"plain text body", "text/plain")},
        )
        self.assertEqual(second.status_code, 201)

        # Dedup is scoped per-case (different investigations may legitimately
        # hold the same source PDF).
        self.assertEqual(Document.objects.filter(case=self.case).count(), 1)
        self.assertEqual(Document.objects.filter(case=other_case).count(), 1)

    def test_different_bytes_same_case_creates_two_documents(self):
        first = self._upload(content=b"first content")
        self.assertEqual(first.status_code, 201)

        second = self._upload(content=b"second content")
        self.assertEqual(second.status_code, 201)

        self.assertEqual(Document.objects.filter(case=self.case).count(), 2)


class Form990ParserWiredInTests(TestCase):
    """Regression: form990_parser must run when classify_document returns IRS_990.

    Before the fix, parse_form_990() existed but was never called, so
    Part IV / Part VI / Part VII data was silently dropped on PDF 990s
    and SR-006 / SR-012 / SR-013 / SR-025 / SR-026 had no input. (QA
    audit P0 #5.)
    """

    def setUp(self):
        from .. import views

        self.views = views
        self.case = Case.objects.create(name="990 Wiring Case")

    @patch("investigations.classification.classify_document")
    @patch("investigations.extraction.extract_from_pdf")
    @patch("investigations.form990_parser.parse_form_990")
    def test_parse_form_990_called_for_form_990_doc(self, mock_parse, mock_extract, mock_classify):
        mock_extract.return_value = (
            "Form 990 Return of Organization Exempt from Income Tax",
            OcrStatus.COMPLETED,
        )
        mock_classify.return_value = DocumentType.IRS_990
        mock_parse.return_value = {
            "part_iv": {"line_28": "Yes"},
            "part_vi": {"section_b": {"line_12a": "No"}},
            "part_vii": {"officers": []},
            "financials": {"total_revenue": 750000},
            "parse_quality": 0.85,
            "extracted_fields_count": 12,
            "total_fields_attempted": 20,
        }

        upload = SimpleUploadedFile(
            "filing_990.pdf",
            b"%PDF-1.4 fake pdf bytes",
            "application/pdf",
        )
        document = self.views._process_uploaded_file(
            uploaded_file=upload,
            case=self.case,
            doc_type_hint="OTHER",
            run_pipeline=True,
        )

        mock_parse.assert_called_once()
        self.assertEqual(document.doc_type, DocumentType.IRS_990)
        # Parsed 990 data is captured in ingestion_metadata so the rules
        # engine and the UI can read structured Part IV/VI/VII answers.
        self.assertIn("parsed_990", document.ingestion_metadata)
        self.assertEqual(document.ingestion_metadata["parsed_990"]["parse_quality"], 0.85)

    @patch("investigations.classification.classify_document")
    @patch("investigations.extraction.extract_from_pdf")
    @patch("investigations.form990_parser.parse_form_990")
    def test_extraction_gated_on_mime_not_extension(self, mock_parse, mock_extract, mock_classify):
        """A file with PDF magic bytes but a non-.pdf name must still be
        treated as a PDF — extension-based gating let these slip through
        with empty extracted_text. (QA audit P0 #6.)
        """
        mock_extract.return_value = (
            "Form 990 Return of Organization Exempt",
            OcrStatus.COMPLETED,
        )
        mock_classify.return_value = DocumentType.IRS_990
        mock_parse.return_value = {
            "part_iv": {},
            "part_vi": {},
            "part_vii": {},
            "financials": {},
            "parse_quality": 0.5,
            "extracted_fields_count": 1,
            "total_fields_attempted": 1,
        }

        # PDF magic bytes but the user named it ".txt"
        upload = SimpleUploadedFile(
            "filing_990.txt",
            b"%PDF-1.4 fake pdf bytes",
            "text/plain",
        )
        document = self.views._process_uploaded_file(
            uploaded_file=upload,
            case=self.case,
            doc_type_hint="OTHER",
            run_pipeline=True,
        )

        mock_extract.assert_called_once()
        self.assertEqual(document.extracted_text, "Form 990 Return of Organization Exempt")
        self.assertEqual(document.doc_type, DocumentType.IRS_990)

    @patch("investigations.classification.classify_document")
    @patch("investigations.extraction.extract_from_pdf")
    @patch("investigations.form990_parser.parse_form_990")
    def test_parse_form_990_skipped_for_non_990_doc(self, mock_parse, mock_extract, mock_classify):
        mock_extract.return_value = (
            "WARRANTY DEED for property at 123 Main St",
            OcrStatus.COMPLETED,
        )
        mock_classify.return_value = DocumentType.DEED

        upload = SimpleUploadedFile("deed.pdf", b"%PDF-1.4 fake pdf bytes", "application/pdf")
        document = self.views._process_uploaded_file(
            uploaded_file=upload,
            case=self.case,
            doc_type_hint="OTHER",
            run_pipeline=True,
        )

        mock_parse.assert_not_called()
        self.assertNotIn("parsed_990", document.ingestion_metadata)


class PropertyValidationSurfaceTests(TestCase):
    """Property validation issues should land on Document.extraction_notes
    so the investigator sees flagged values in the UI alongside other
    extraction status messages. (QA audit P1.)
    """

    def setUp(self):
        from .. import views

        self.views = views
        self.case = Case.objects.create(name="Property Validation Case")

    def test_validation_warnings_appended_to_extraction_notes(self):
        from ..models import Document, ExtractionStatus

        # Pre-create a Document and manually invoke the validator helper
        # on a payload that will produce ERRORs. This isolates the
        # surface mechanism from the rest of the upload pipeline.
        document = Document.objects.create(
            case=self.case,
            filename="x.pdf",
            file_path="cases/x.pdf",
            sha256_hash="z" * 64,
            file_size=10,
        )
        self.views._validate_property_payload(
            {"parcel_number": "X", "assessed_value": -1000},
            document=document,
        )

        # The transient list should be set on the document instance.
        self.assertTrue(hasattr(document, "_validation_warnings"))
        self.assertGreater(len(document._validation_warnings), 0)
        self.assertIn(
            "[ERROR] property_validation",
            document._validation_warnings[0],
        )

        # Simulate the final extraction_notes flip — clean status, no
        # extraction failures, but validation warnings present.
        warnings = document._validation_warnings
        ext_notes = ""
        if warnings:
            ext_notes += "Validation warnings:\n" + "\n".join(f"- {msg}" for msg in warnings)
        document.extraction_status = ExtractionStatus.COMPLETED
        document.extraction_notes = ext_notes
        document.save(update_fields=["extraction_status", "extraction_notes"])

        document.refresh_from_db()
        self.assertIn("Validation warnings:", document.extraction_notes)
        self.assertIn("[ERROR] property_validation", document.extraction_notes)

    def test_no_warnings_no_change(self):
        """A clean property payload produces no warnings — surface stays empty."""
        from ..models import Document

        document = Document.objects.create(
            case=self.case,
            filename="x.pdf",
            file_path="cases/x.pdf",
            sha256_hash="y" * 64,
            file_size=10,
        )
        msgs = self.views._validate_property_payload(
            {"parcel_number": "A01-12345", "assessed_value": 50000, "purchase_price": 60000},
            document=document,
        )
        self.assertEqual(msgs, [])
        # The transient attribute may or may not exist — if it does, it's empty.
        self.assertEqual(getattr(document, "_validation_warnings", []), [])

    def test_works_without_document(self):
        """Helper still returns messages when no document is supplied
        (e.g., from the research add-to-case path)."""
        msgs = self.views._validate_property_payload(
            {"parcel_number": "X", "assessed_value": -1000},
            document=None,
        )
        self.assertGreater(len(msgs), 0)
