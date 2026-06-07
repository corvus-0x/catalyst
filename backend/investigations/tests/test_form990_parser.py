"""Tests for form990_parser — text-based 990 governance/finance extractor.

Pure-function module; no DB needed. The parser regex-matches against
already-extracted text from a 990 PDF (text-layer or OCR'd) and returns a
structured dict for downstream signal evaluation. These tests fixture
realistic 990 text snippets and verify each section parses correctly.

The parser is wired into the upload pipeline (per QA P0 #5) so its
correctness is load-bearing for SR-006 / SR-012 / SR-013 / SR-025 / SR-028.
"""

from django.test import SimpleTestCase

from ..form990_parser import (
    get_governance_red_flags,
    parse_form_990,
)

# Realistic 990 text fixture covering the key sections. Whitespace and
# newlines mirror what extraction.py / OCR typically produces.
_FIXTURE_990 = """
Form 990 Return of Organization Exempt From Income Tax
For the calendar year 2023

Part IV Checklist of Required Schedules
25a Did the organization engage in a business transaction with current officers? No
25b Did the organization engage in a transaction with former officers? No
26 Did the organization make a loan or advance to or from an officer? No
28a Was the organization a party to a receivable from an officer? Yes
28b Did the organization make any loan or advance to an officer? No
28c Did the organization grant assistance to an officer? No
29 Did the organization receive any business transaction with an interested person? Yes

Part VI Governance, Management, and Disclosure
Section A. Governing Body and Management
1a Total number of voting members of the governing body 7
1b Total number of independent voting members 5
2 Did any officer have a family or business relationship? No
5 Did the organization become aware of a significant diversion of assets? No

Section B. Policies
12a Did the organization have a written conflict of interest policy? No
13 Did the organization have a written whistleblower policy? Yes
14 Did the organization have a written document retention policy? Yes
"""


class ParseForm990HappyPathTests(SimpleTestCase):
    def setUp(self):
        self.result = parse_form_990(_FIXTURE_990)

    def test_returns_dict_with_expected_top_keys(self):
        for key in (
            "part_iv",
            "part_vi",
            "part_vii",
            "financials",
            "parse_quality",
            "extracted_fields_count",
            "total_fields_attempted",
        ):
            self.assertIn(key, self.result)

    def test_part_iv_yes_no_answers(self):
        part_iv = self.result["part_iv"]
        self.assertEqual(part_iv["line_28a"], "Yes")
        self.assertEqual(part_iv["line_29"], "Yes")
        self.assertEqual(part_iv["line_25a"], "No")

    def test_part_vi_section_a_board_counts(self):
        section_a = self.result["part_vi"]["section_a"]
        self.assertEqual(section_a["line_1a"], 7)
        self.assertEqual(section_a["line_1b"], 5)

    def test_part_vi_section_b_policies(self):
        section_b = self.result["part_vi"]["section_b"]
        self.assertEqual(section_b["line_12a"], "No")
        self.assertEqual(section_b["line_13"], "Yes")
        self.assertEqual(section_b["line_14"], "Yes")

    def test_extraction_count_is_positive(self):
        self.assertGreater(self.result["extracted_fields_count"], 0)
        self.assertGreater(self.result["total_fields_attempted"], 0)

    def test_parse_quality_in_unit_range(self):
        q = self.result["parse_quality"]
        self.assertGreaterEqual(q, 0.0)
        self.assertLessEqual(q, 1.0)


class ParseForm990EdgeCaseTests(SimpleTestCase):
    def test_empty_text_returns_zero_quality(self):
        result = parse_form_990("")
        self.assertEqual(result["extracted_fields_count"], 0)
        self.assertEqual(result["parse_quality"], 0.0)

    def test_unrelated_text_does_not_match(self):
        # Any document that isn't a 990 should match nothing.
        text = (
            "WARRANTY DEED\nThis indenture witnesseth the conveyance of "
            "real property from grantor to grantee for consideration paid."
        )
        result = parse_form_990(text)
        self.assertEqual(result["extracted_fields_count"], 0)

    def test_handles_x_checkbox_marker(self):
        # 990 forms often use "X" or "☒" instead of "Yes" in machine-printed
        # boxes. The parser should accept either as a positive answer.
        text = "Part IV Checklist\n29 Business transaction with interested person? X\n"
        result = parse_form_990(text)
        # Either "Yes" or "X" depending on _normalize_yes_no; whichever it
        # is, the value must be truthy and non-None.
        self.assertIsNotNone(result["part_iv"].get("line_29"))


class GovernanceRedFlagsTests(SimpleTestCase):
    """get_governance_red_flags() turns parsed data into investigator-readable strings."""

    def test_no_coi_policy_flagged(self):
        parsed = {
            "part_iv": {},
            "part_vi": {
                "section_a": {},
                "section_b": {"line_12a": "No"},
            },
        }
        flags = get_governance_red_flags(parsed)
        self.assertTrue(
            any("conflict of interest" in f.lower() for f in flags),
            f"Expected COI flag in {flags!r}",
        )

    def test_zero_independent_board_members_flagged(self):
        parsed = {
            "part_iv": {},
            "part_vi": {
                "section_a": {"line_1a": 7, "line_1b": 0},
                "section_b": {},
            },
        }
        flags = get_governance_red_flags(parsed)
        self.assertTrue(
            any("independent board" in f.lower() for f in flags),
            f"Expected independent-board flag in {flags!r}",
        )

    def test_clean_governance_returns_no_flags(self):
        parsed = {
            "part_iv": {},
            "part_vi": {
                "section_a": {"line_1a": 7, "line_1b": 5},
                "section_b": {
                    "line_12a": "Yes",
                    "line_13": "Yes",
                    "line_14": "Yes",
                },
            },
        }
        flags = get_governance_red_flags(parsed)
        self.assertEqual(flags, [])

    def test_missing_data_does_not_crash(self):
        # Defensive: empty / partial dicts must not raise.
        flags = get_governance_red_flags({"part_iv": {}, "part_vi": {}})
        self.assertEqual(flags, [])

        flags = get_governance_red_flags({})
        self.assertIsInstance(flags, list)
