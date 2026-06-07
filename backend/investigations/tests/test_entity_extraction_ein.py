"""Tests for EIN extraction in entity_extraction.

Before this fix, extract_entities() never extracted EINs at all — the regex
didn't exist. PDF 990s arrived without an EIN attached, which silently
disabled SR-006 / SR-010 / SR-012 / SR-013 (all keyed off Organization.ein).
"""

from django.test import SimpleTestCase

from ..entity_extraction import extract_entities


class EinExtractionTests(SimpleTestCase):
    def test_finds_ein_after_label(self):
        text = "Form 990 — EIN: 12-3456789 — return of organization"
        result = extract_entities(text, doc_type="IRS_990")
        self.assertEqual(len(result["eins"]), 1)
        self.assertEqual(result["eins"][0]["normalized"], "12-3456789")
        self.assertEqual(result["meta"]["org_ein"], "12-3456789")

    def test_finds_ein_after_full_label(self):
        text = "Employer Identification Number 34-5678901 was issued in 2020."
        result = extract_entities(text)
        self.assertEqual(len(result["eins"]), 1)
        self.assertEqual(result["eins"][0]["normalized"], "34-5678901")

    def test_finds_ein_after_tax_id_label(self):
        text = "Tax ID Number: 56-7890123"
        result = extract_entities(text)
        self.assertEqual(len(result["eins"]), 1)

    def test_does_not_match_phone_number(self):
        # "23-4567890" is a 9-digit dashed string but appears with no EIN
        # cue nearby — must not be flagged as an EIN.
        text = "Call our office: 555-321-4567 or send a fax to 23-4567890."
        result = extract_entities(text)
        self.assertEqual(result["eins"], [])
        self.assertEqual(result["meta"]["org_ein"], "")

    def test_uses_first_qualifying_ein_as_primary(self):
        text = "Primary org EIN: 11-1111111. Subsidiary EIN: 22-2222222."
        result = extract_entities(text)
        # Both labels are detected; first match wins for primary_ein.
        self.assertEqual(result["meta"]["org_ein"], "11-1111111")
        self.assertEqual(
            [e["normalized"] for e in result["eins"]],
            ["11-1111111", "22-2222222"],
        )

    def test_dedups_repeated_ein(self):
        text = "EIN 12-3456789. ... See EIN 12-3456789 again."
        result = extract_entities(text)
        self.assertEqual(len(result["eins"]), 1)

    def test_ein_label_window_only_forward(self):
        # An EIN that appears BEFORE the label (no preceding label cue)
        # should not be matched. Labels typically precede their values on
        # forms; reverse cases are rare and likely false positives.
        text = "12-3456789 is the value somewhere; later we see EIN here."
        result = extract_entities(text)
        # The "EIN" cue at the end has no value within 80 chars after it.
        self.assertEqual(result["eins"], [])

    def test_empty_text_returns_empty_eins(self):
        result = extract_entities("")
        self.assertEqual(result["eins"], [])
        self.assertEqual(result["meta"]["org_ein"], "")
