"""Tests for data_quality validators.

Pure-function module; no DB needed. Uses SimpleTestCase for speed.

These validators are now wired into entity_resolution.resolve_person /
resolve_org and the four Property creation paths in views.py. Their
output is logged for investigator review; ERROR-severity issues do
NOT block creation (the entity still gets a row). Tests verify each
validator's pass/fail conditions across realistic and adversarial inputs.
"""

from datetime import date

from django.test import SimpleTestCase

from ..data_quality import (
    validate_ein,
    validate_financial_snapshot,
    validate_person,
    validate_property,
)


class ValidateEinTests(SimpleTestCase):
    def test_valid_ein_passes(self):
        result = validate_ein("12-3456789")
        self.assertTrue(result.is_clean)
        self.assertEqual(result.error_count, 0)
        self.assertEqual(result.corrected_data["ein"], "12-3456789")

    def test_dashless_ein_normalized_to_canonical_form(self):
        result = validate_ein("123456789")
        self.assertTrue(result.is_clean)
        self.assertEqual(result.corrected_data["ein"], "12-3456789")

    def test_empty_ein_is_error(self):
        result = validate_ein("")
        self.assertEqual(result.error_count, 1)
        self.assertFalse(result.is_clean)

    def test_wrong_format_is_error(self):
        result = validate_ein("not an ein")
        self.assertEqual(result.error_count, 1)

    def test_too_short_is_error(self):
        # 8 digits — short of the required 9.
        result = validate_ein("12345678")
        self.assertEqual(result.error_count, 1)

    def test_invalid_prefix_is_warning_not_error(self):
        # 07 is not an IRS-assigned prefix → WARNING (still parseable).
        result = validate_ein("07-1234567")
        self.assertEqual(result.warning_count, 1)
        # No error — corrected_data still populated.
        self.assertEqual(result.corrected_data["ein"], "07-1234567")

    def test_placeholder_all_zeros_is_error(self):
        result = validate_ein("00-0000000")
        self.assertGreaterEqual(result.error_count, 1)

    def test_placeholder_all_nines_is_error(self):
        result = validate_ein("99-9999999")
        self.assertGreaterEqual(result.error_count, 1)


class ValidatePersonTests(SimpleTestCase):
    def test_valid_person_passes(self):
        result = validate_person({"full_name": "John Smith"})
        self.assertTrue(result.is_clean)

    def test_empty_name_is_error(self):
        result = validate_person({"full_name": ""})
        self.assertEqual(result.error_count, 1)

    def test_missing_full_name_is_error(self):
        result = validate_person({})
        self.assertEqual(result.error_count, 1)

    def test_short_name_is_warning(self):
        # < 3 chars → suspicious. Use mixed case so we don't also trip the
        # all-caps state-abbreviation junk pattern (which would add an error).
        result = validate_person({"full_name": "Jo"})
        self.assertEqual(result.warning_count, 1)
        self.assertEqual(result.error_count, 0)

    def test_two_letter_all_caps_is_junk_error(self):
        # "JS" matches the state-abbreviation junk pattern → ERROR.
        result = validate_person({"full_name": "JS"})
        self.assertEqual(result.error_count, 1)

    def test_form_label_is_junk_error(self):
        # OCR sometimes captures "Section A" as a person name.
        result = validate_person({"full_name": "Section A"})
        self.assertEqual(result.error_count, 1)

    def test_future_date_of_death_is_error(self):
        from datetime import timedelta

        future = date.today() + timedelta(days=30)
        result = validate_person({"full_name": "John Smith", "date_of_death": future})
        self.assertEqual(result.error_count, 1)

    def test_past_date_of_death_passes(self):
        result = validate_person({"full_name": "John Smith", "date_of_death": date(1990, 1, 1)})
        self.assertTrue(result.is_clean)


class ValidatePropertyTests(SimpleTestCase):
    def test_valid_property_passes(self):
        result = validate_property(
            {
                "parcel_number": "A01-12345",
                "county": "DARKE",
                "assessed_value": 100_000,
                "purchase_price": 150_000,
            }
        )
        self.assertTrue(result.is_clean)

    def test_negative_assessed_value_is_error(self):
        result = validate_property({"parcel_number": "X", "assessed_value": -1000})
        self.assertGreaterEqual(result.error_count, 1)

    def test_negative_purchase_price_is_error(self):
        result = validate_property({"parcel_number": "X", "purchase_price": -1000})
        self.assertGreaterEqual(result.error_count, 1)

    def test_zero_values_are_acceptable(self):
        # Land donated for $0 is real — the rule fires elsewhere (SR-005)
        # but the validator must not reject it.
        result = validate_property(
            {"parcel_number": "X", "purchase_price": 0, "assessed_value": 50_000}
        )
        # No errors on zero-consideration; warnings about the deviation are OK.
        self.assertEqual(result.error_count, 0)

    def test_empty_payload_does_not_crash(self):
        result = validate_property({})
        # Empty payload may have warnings/errors but must not raise.
        self.assertIsNotNone(result)


class ValidateFinancialSnapshotTests(SimpleTestCase):
    def test_valid_snapshot_passes(self):
        result = validate_financial_snapshot(
            {
                "tax_year": 2023,
                "total_revenue": 1_000_000,
                "total_expenses": 800_000,
                "revenue_less_expenses": 200_000,
            }
        )
        self.assertTrue(result.is_clean)

    def test_missing_tax_year_is_error(self):
        result = validate_financial_snapshot({"total_revenue": 100_000, "total_expenses": 50_000})
        self.assertGreaterEqual(result.error_count, 1)

    def test_tax_year_too_old_is_error(self):
        # Pre-1990 is outside the valid range — likely OCR'd from a stale form.
        result = validate_financial_snapshot({"tax_year": 1985, "total_revenue": 100})
        self.assertGreaterEqual(result.error_count, 1)

    def test_tax_year_too_far_in_future_is_error(self):
        result = validate_financial_snapshot(
            {"tax_year": date.today().year + 5, "total_revenue": 100}
        )
        self.assertGreaterEqual(result.error_count, 1)

    def test_revenue_minus_expenses_mismatch_is_warning(self):
        # rev_less_exp doesn't match rev - exp → likely extraction error.
        result = validate_financial_snapshot(
            {
                "tax_year": 2023,
                "total_revenue": 1_000_000,
                "total_expenses": 800_000,
                "revenue_less_expenses": 999_999,  # should be 200_000
            }
        )
        self.assertGreaterEqual(result.warning_count, 1)

    def test_excessive_revenue_is_warning(self):
        # $50B revenue is implausible for a nonprofit — likely an OCR'd
        # extra digit ($5B → $50B → flag).
        result = validate_financial_snapshot({"tax_year": 2023, "total_revenue": 50_000_000_000})
        self.assertGreaterEqual(result.warning_count, 1)

    def test_non_numeric_value_is_error(self):
        result = validate_financial_snapshot({"tax_year": 2023, "total_revenue": "lots of money"})
        self.assertGreaterEqual(result.error_count, 1)
