"""Tests for extract_entities — persons, orgs, dates, amounts, parcels, filing refs.

EIN extraction is covered in test_entity_extraction_ein.py. This file
covers everything else: the regex layers that pull entity data out of
extracted document text.
"""

from django.test import SimpleTestCase

from ..entity_extraction import extract_entities

# Pad fixtures to comfortably exceed the 50-char short-circuit in the
# classifier-adjacent code paths and to give regexes realistic context.
_PAD = "This document is a sample for unit testing extraction patterns. " * 2


class ExtractPersonsTests(SimpleTestCase):
    def test_labeled_grantor_grantee(self):
        text = f"WARRANTY DEED\nGRANTOR: John A. Smith\nGRANTEE: Jane Doe\n{_PAD}"
        result = extract_entities(text, doc_type="DEED")
        names = [p["raw"] for p in result["persons"]]
        self.assertIn("John A. Smith", names)
        self.assertIn("Jane Doe", names)

    def test_inverted_names_uninverted(self):
        # "SMITH, JOHN A." form is common in court filings and 990s.
        text = f"SMITH, JOHN A.\nDOE, JANE B.\n{_PAD}"
        result = extract_entities(text, doc_type="OTHER")
        names = [p["raw"] for p in result["persons"]]
        # The inverted form is normalized to "John A Smith" / "Jane B Doe".
        self.assertTrue(
            any("Smith" in n and "John" in n for n in names),
            f"Expected John Smith form in {names!r}",
        )
        self.assertTrue(any("Doe" in n and "Jane" in n for n in names))

    def test_dedups_repeated_person(self):
        text = f"GRANTOR: John A. Smith\nGRANTOR: John A. Smith\nGRANTOR: John A. Smith\n{_PAD}"
        result = extract_entities(text, doc_type="DEED")
        smiths = [p for p in result["persons"] if "John A. Smith" == p["raw"]]
        self.assertEqual(len(smiths), 1)

    def test_empty_text_returns_no_persons(self):
        self.assertEqual(extract_entities("", doc_type="OTHER")["persons"], [])


class ExtractOrgsTests(SimpleTestCase):
    def test_finds_inc_designator(self):
        text = f"The Bright Future Foundation, Inc. is a 501(c)(3) charity. {_PAD}"
        result = extract_entities(text, doc_type="OTHER")
        names = [o["raw"] for o in result["orgs"]]
        self.assertTrue(
            any("Bright Future" in n for n in names),
            f"Expected Bright Future org in {names!r}",
        )

    def test_finds_llc(self):
        text = f"Acme Holdings, LLC and its subsidiaries operate in Ohio. {_PAD}"
        result = extract_entities(text, doc_type="OTHER")
        names = [o["raw"] for o in result["orgs"]]
        self.assertTrue(any("Acme Holdings" in n for n in names))


class ExtractDatesTests(SimpleTestCase):
    def test_normalizes_us_slash_format(self):
        text = f"Recorded on 03/15/2023 in the county. {_PAD}"
        result = extract_entities(text, doc_type="DEED")
        normalized = [d.get("normalized") for d in result["dates"]]
        self.assertIn("2023-03-15", normalized)

    def test_normalizes_iso_format(self):
        text = f"Filing date 2023-03-16 for case review. {_PAD}"
        result = extract_entities(text, doc_type="OTHER")
        normalized = [d.get("normalized") for d in result["dates"]]
        self.assertIn("2023-03-16", normalized)

    def test_finds_multiple_dates(self):
        text = (
            f"Recorded on 03/15/2023 and indexed 2023-03-16. The original "
            f"deed was dated 06/01/2020. {_PAD}"
        )
        result = extract_entities(text, doc_type="DEED")
        normalized = sorted(d.get("normalized") for d in result["dates"] if d.get("normalized"))
        self.assertIn("2023-03-15", normalized)
        self.assertIn("2023-03-16", normalized)


class ExtractAmountsTests(SimpleTestCase):
    def test_finds_dollar_amount_with_commas(self):
        text = f"Consideration: $250,000.00 paid at closing. {_PAD}"
        result = extract_entities(text, doc_type="DEED")
        normalized = [a.get("normalized") for a in result["amounts"]]
        self.assertIn(250000.0, normalized)

    def test_finds_multiple_amounts(self):
        text = f"Total revenue $1,000,000. Total expenses $850,000. Net: $150,000. {_PAD}"
        result = extract_entities(text, doc_type="OTHER")
        normalized = [a.get("normalized") for a in result["amounts"]]
        self.assertIn(1_000_000.0, normalized)
        self.assertIn(850_000.0, normalized)


class ExtractParcelsTests(SimpleTestCase):
    def test_finds_dashed_parcel_number(self):
        text = f"Parcel: A01-12345 located in Darke County. {_PAD}"
        result = extract_entities(text, doc_type="DEED")
        parcels = [p["raw"] for p in result["parcels"]]
        self.assertIn("A01-12345", parcels)


class ExtractFilingRefsTests(SimpleTestCase):
    def test_finds_ohio_ucc_number(self):
        text = f"UCC-1 Financing Statement filed under OH 12345678901 in 2022. {_PAD}"
        result = extract_entities(text, doc_type="UCC")
        refs = [f["raw"] for f in result["filing_refs"]]
        self.assertTrue(any("12345678901" in r for r in refs))

    def test_finds_county_instrument_number(self):
        text = f"Subsequent amendment FH 2022-001234 added new collateral. {_PAD}"
        result = extract_entities(text, doc_type="UCC")
        refs = [f["raw"] for f in result["filing_refs"]]
        self.assertTrue(any("2022-001234" in r for r in refs))


class ExtractEntitiesEmptyTests(SimpleTestCase):
    def test_empty_text_returns_zero_counts(self):
        result = extract_entities("", doc_type="OTHER")
        self.assertEqual(result["persons"], [])
        self.assertEqual(result["orgs"], [])
        self.assertEqual(result["dates"], [])
        self.assertEqual(result["amounts"], [])
        self.assertEqual(result["parcels"], [])
        self.assertEqual(result["filing_refs"], [])
        self.assertEqual(result["meta"]["text_length"], 0)

    def test_meta_counts_match_lists(self):
        text = (
            f"GRANTOR: John A. Smith\n"
            f"GRANTEE: Jane Doe\n"
            f"Recorded 03/15/2023 for $100,000. Parcel A01-12345. {_PAD}"
        )
        result = extract_entities(text, doc_type="DEED")
        meta = result["meta"]
        self.assertEqual(meta["person_count"], len(result["persons"]))
        self.assertEqual(meta["org_count"], len(result["orgs"]))
        self.assertEqual(meta["date_count"], len(result["dates"]))
        self.assertEqual(meta["amount_count"], len(result["amounts"]))
        self.assertEqual(meta["parcel_count"], len(result["parcels"]))
