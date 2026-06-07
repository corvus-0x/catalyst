"""Tests for extraction.py — PDF text extraction + OCR fallback.

Most tests use mocks for PyMuPDF (fitz) and Tesseract (pytesseract) so the
suite doesn't need real PDF fixtures or the OCR binary installed locally.
The two helpers that ARE tested with real bytes are the magic-byte
validator (which only reads the first 5 bytes) and the PDF date
normalizer (which is pure-function string parsing).
"""

import os
import tempfile
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from ..extraction import (
    _normalize_pdf_date,
    _validate_pdf_header,
    extract_from_pdf,
)


class ValidatePdfHeaderTests(SimpleTestCase):
    """Magic-byte gate — runs on every uploaded PDF before any parsing."""

    def _temp_file_with_bytes(self, payload: bytes) -> str:
        fd, path = tempfile.mkstemp(suffix=".pdf")
        with os.fdopen(fd, "wb") as f:
            f.write(payload)
        self.addCleanup(os.unlink, path)
        return path

    def test_real_pdf_magic_bytes_pass(self):
        path = self._temp_file_with_bytes(b"%PDF-1.7\n%\xa0\xb1\xc2\xd3")
        self.assertTrue(_validate_pdf_header(path))

    def test_random_bytes_rejected(self):
        path = self._temp_file_with_bytes(b"This is not a PDF.")
        self.assertFalse(_validate_pdf_header(path))

    def test_executable_bytes_rejected(self):
        # Windows MZ header — sometimes a renamed .exe sneaks in.
        path = self._temp_file_with_bytes(b"MZ\x90\x00\x03\x00\x00\x00")
        self.assertFalse(_validate_pdf_header(path))

    def test_empty_file_rejected(self):
        path = self._temp_file_with_bytes(b"")
        self.assertFalse(_validate_pdf_header(path))

    def test_nonexistent_path_returns_false(self):
        self.assertFalse(_validate_pdf_header("/nonexistent/path/x.pdf"))


class NormalizePdfDateTests(SimpleTestCase):
    """PDF dates look like D:20220915120000-04'00'. Convert to ISO."""

    def test_full_datetime_with_timezone(self):
        self.assertEqual(
            _normalize_pdf_date("D:20220915120000-04'00'"),
            "2022-09-15T12:00:00",
        )

    def test_date_only(self):
        self.assertEqual(_normalize_pdf_date("D:20220915"), "2022-09-15")

    def test_no_d_prefix(self):
        self.assertEqual(_normalize_pdf_date("20220915120000"), "2022-09-15T12:00:00")

    def test_empty_returns_empty(self):
        self.assertEqual(_normalize_pdf_date(""), "")

    def test_unparseable_returns_empty(self):
        self.assertEqual(_normalize_pdf_date("not a date"), "")

    def test_short_string_returns_empty(self):
        self.assertEqual(_normalize_pdf_date("D:2022"), "")


class ExtractFromPdfRoutingTests(SimpleTestCase):
    """extract_from_pdf is a router across header/direct/OCR paths.

    These tests pin the routing logic without needing real PDFs.
    """

    @patch("investigations.extraction._validate_pdf_header")
    def test_invalid_pdf_header_returns_failed(self, mock_validate):
        from ..models import OcrStatus

        mock_validate.return_value = False
        text, status = extract_from_pdf("/fake/path.pdf", file_size=1000)
        self.assertEqual(text, "")
        self.assertEqual(status, OcrStatus.FAILED)

    @patch("investigations.extraction._extract_text_direct")
    @patch("investigations.extraction._validate_pdf_header")
    def test_direct_extraction_with_meaningful_text_returns_not_needed(
        self, mock_validate, mock_direct
    ):
        from ..models import OcrStatus

        mock_validate.return_value = True
        # Return a string longer than _MIN_MEANINGFUL_LENGTH (100 chars).
        mock_direct.return_value = "Real readable text extracted from the PDF. " * 5

        text, status = extract_from_pdf("/fake/path.pdf", file_size=1000)

        self.assertEqual(status, OcrStatus.NOT_NEEDED)
        self.assertGreaterEqual(len(text), 100)

    @patch("investigations.extraction._extract_text_ocr")
    @patch("investigations.extraction._extract_text_direct")
    @patch("investigations.extraction._validate_pdf_header")
    def test_sparse_text_falls_back_to_ocr(self, mock_validate, mock_direct, mock_ocr):
        from ..models import OcrStatus

        mock_validate.return_value = True
        mock_direct.return_value = "tiny"  # below _MIN_MEANINGFUL_LENGTH
        mock_ocr.return_value = "OCR'd text from a scanned page. " * 10

        text, status = extract_from_pdf("/fake/path.pdf", file_size=1_000_000)

        mock_ocr.assert_called_once()
        self.assertEqual(status, OcrStatus.COMPLETED)
        self.assertIn("OCR'd text", text)

    @patch("investigations.extraction._extract_text_ocr")
    @patch("investigations.extraction._extract_text_direct")
    @patch("investigations.extraction._validate_pdf_header")
    def test_oversized_file_skips_ocr_returns_pending(self, mock_validate, mock_direct, mock_ocr):
        from ..models import OcrStatus

        mock_validate.return_value = True
        mock_direct.return_value = "tiny"
        # 50 MB is > MAX_SYNC_OCR_BYTES = 30 MB
        text, status = extract_from_pdf("/fake/path.pdf", file_size=50 * 1024 * 1024)

        mock_ocr.assert_not_called()
        self.assertEqual(status, OcrStatus.PENDING)
        self.assertEqual(text, "tiny")

    @patch("investigations.extraction._extract_text_direct")
    @patch("investigations.extraction._validate_pdf_header")
    def test_direct_extraction_file_not_found_returns_failed(self, mock_validate, mock_direct):
        from ..models import OcrStatus

        mock_validate.return_value = True
        mock_direct.side_effect = FileNotFoundError("missing")

        text, status = extract_from_pdf("/fake/path.pdf", file_size=1000)
        self.assertEqual(text, "")
        self.assertEqual(status, OcrStatus.FAILED)

    @patch("investigations.extraction._extract_text_ocr")
    @patch("investigations.extraction._extract_text_direct")
    @patch("investigations.extraction._validate_pdf_header")
    def test_ocr_failure_keeps_sparse_direct_text_marks_failed(
        self, mock_validate, mock_direct, mock_ocr
    ):
        from ..models import OcrStatus

        mock_validate.return_value = True
        mock_direct.return_value = "sparse text"
        mock_ocr.side_effect = RuntimeError("tesseract crashed")

        text, status = extract_from_pdf("/fake/path.pdf", file_size=1_000_000)
        # Failure preserves whatever direct text we got — caller can decide
        # whether to keep it or discard it as untrustworthy.
        self.assertEqual(text, "sparse text")
        self.assertEqual(status, OcrStatus.FAILED)


class ExtractPdfMetadataTests(SimpleTestCase):
    """Chain-of-custody metadata capture — author, creator, dates, page count."""

    @patch("investigations.extraction.fitz.open")
    def test_extracts_metadata_fields(self, mock_open):
        from ..extraction import extract_pdf_metadata

        mock_doc = MagicMock()
        mock_doc.__len__.return_value = 5
        mock_doc.is_encrypted = False
        mock_doc.metadata = {
            "title": "Form 990",
            "author": "Bright Future Foundation",
            "subject": "Annual Return",
            "creator": "Adobe Acrobat",
            "producer": "PDFLib",
            "format": "PDF 1.7",
            "creationDate": "D:20231015120000-04'00'",
            "modDate": "D:20231016130000-04'00'",
        }
        # No widgets / forms
        mock_doc.__iter__.return_value = iter([])
        mock_open.return_value.__enter__.return_value = mock_doc

        meta = extract_pdf_metadata("/fake/path.pdf")

        self.assertEqual(meta["title"], "Form 990")
        self.assertEqual(meta["author"], "Bright Future Foundation")
        self.assertEqual(meta["page_count"], 5)
        self.assertFalse(meta["encrypted"])
        self.assertFalse(meta["has_forms"])
        self.assertEqual(meta["creation_date"], "2023-10-15T12:00:00")
        self.assertEqual(meta["modification_date"], "2023-10-16T13:00:00")

    @patch("investigations.extraction.fitz.open")
    def test_metadata_extraction_never_raises(self, mock_open):
        """Any error in metadata reading must yield the default dict, not crash."""
        from ..extraction import extract_pdf_metadata

        mock_open.side_effect = RuntimeError("corrupt PDF")

        meta = extract_pdf_metadata("/fake/path.pdf")

        # Default values intact — the upload pipeline still gets a usable dict.
        self.assertEqual(meta["title"], "")
        self.assertEqual(meta["page_count"], 0)
        self.assertEqual(meta["author"], "")
