"""Tests for entity_normalization — pure-function string canonicalizers.

Pure-function module; no DB needed. Uses SimpleTestCase for speed.

These canonicalizers underpin the resolver's exact-match tier. Any
regression here silently turns "John Smith" and "JOHN SMITH" into two
different Persons in the same case — the kind of bug that erodes
confidence in the referral PDF.
"""

from django.test import SimpleTestCase

from ..entity_normalization import (
    normalize_amount_string,
    normalize_date_string,
    normalize_org_name,
    normalize_person_name,
)


class NormalizePersonNameTests(SimpleTestCase):
    def test_lowercases_and_collapses(self):
        self.assertEqual(normalize_person_name("John A. Smith"), "john a smith")

    def test_inverted_form_uninverted(self):
        self.assertEqual(normalize_person_name("EXAMPLE, JOHN A."), "john a example")

    def test_strips_honorifics(self):
        self.assertEqual(normalize_person_name("Dr. Jane Doe"), "jane doe")
        self.assertEqual(normalize_person_name("Mrs. Jane Smith"), "jane smith")
        self.assertEqual(normalize_person_name("Prof. Sarah Example"), "sarah example")

    def test_strips_trailing_suffixes(self):
        self.assertEqual(normalize_person_name("John Doe Jr."), "john doe")
        self.assertEqual(normalize_person_name("John Doe III"), "john doe")
        self.assertEqual(normalize_person_name("John Doe, Sr."), "john doe")

    def test_preserves_hyphens_and_apostrophes(self):
        self.assertEqual(normalize_person_name("Jean-Paul O'Brien"), "jean-paul o'brien")

    def test_empty_input_returns_empty(self):
        self.assertEqual(normalize_person_name(""), "")
        self.assertEqual(normalize_person_name("   "), "")

    def test_unicode_accents_stripped(self):
        # _strip_unicode normalizes accented chars to plain ASCII for matching.
        self.assertEqual(normalize_person_name("José García"), "jose garcia")

    def test_two_forms_of_same_name_match(self):
        # The whole point of normalization: "John Smith" and "Smith, John"
        # and "JOHN SMITH" all canonicalize to the same key.
        canonical = normalize_person_name("John Smith")
        self.assertEqual(normalize_person_name("Smith, John"), canonical)
        self.assertEqual(normalize_person_name("JOHN SMITH"), canonical)
        self.assertEqual(normalize_person_name("john smith"), canonical)


class NormalizeOrgNameTests(SimpleTestCase):
    def test_strips_trailing_inc(self):
        self.assertEqual(normalize_org_name("Acme Holdings, Inc."), "acme holdings")
        self.assertEqual(normalize_org_name("Acme Holdings Inc"), "acme holdings")

    def test_strips_llc(self):
        self.assertEqual(normalize_org_name("Acme Holdings, LLC"), "acme holdings")
        self.assertEqual(normalize_org_name("Acme Holdings L.L.C."), "acme holdings")

    def test_strips_filler_words(self):
        self.assertEqual(normalize_org_name("The Doe Foundation"), "doe foundation")
        self.assertEqual(normalize_org_name("Friends of the Library"), "friends library")

    def test_preserves_distinguishing_words(self):
        # Should NOT strip "Holdings", "Charity", etc. — those carry meaning.
        self.assertEqual(normalize_org_name("Bright Future Charity"), "bright future charity")

    def test_empty_input_returns_empty(self):
        self.assertEqual(normalize_org_name(""), "")
        self.assertEqual(normalize_org_name("   "), "")

    def test_two_designator_forms_match(self):
        canonical = normalize_org_name("Acme Holdings")
        self.assertEqual(normalize_org_name("Acme Holdings, Inc."), canonical)
        self.assertEqual(normalize_org_name("Acme Holdings LLC"), canonical)
        self.assertEqual(normalize_org_name("Acme Holdings Corp."), canonical)


class NormalizeDateStringTests(SimpleTestCase):
    def test_iso_passthrough(self):
        self.assertEqual(normalize_date_string("2022-03-02"), "2022-03-02")

    def test_us_slash_format(self):
        self.assertEqual(normalize_date_string("03/02/2022"), "2022-03-02")

    def test_us_dash_format(self):
        self.assertEqual(normalize_date_string("3-2-2022"), "2022-03-02")

    def test_unparseable_returns_none(self):
        self.assertIsNone(normalize_date_string("not a date"))
        self.assertIsNone(normalize_date_string("13/45/9999"))  # invalid month/day

    def test_strips_whitespace(self):
        self.assertEqual(normalize_date_string("  2022-03-02 "), "2022-03-02")


class NormalizeAmountStringTests(SimpleTestCase):
    def test_strips_dollar_and_commas(self):
        self.assertEqual(normalize_amount_string("$4,505,000.00"), 4505000.0)

    def test_plain_number(self):
        self.assertEqual(normalize_amount_string("4505000"), 4505000.0)

    def test_with_dollar_no_decimals(self):
        self.assertEqual(normalize_amount_string("$300,000"), 300000.0)

    def test_unparseable_returns_none(self):
        self.assertIsNone(normalize_amount_string("not a number"))
        self.assertIsNone(normalize_amount_string("$"))

    def test_strips_whitespace(self):
        self.assertEqual(normalize_amount_string("  $1,234  "), 1234.0)
