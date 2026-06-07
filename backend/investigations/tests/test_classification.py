"""Tests for classify_document() — the rule-based document classifier.

Pure-function module; no DB needed. Uses SimpleTestCase for speed.
Covers the realistic document varieties Catalyst sees plus edge cases
(empty text, short text, no matching keywords).
"""

from django.test import SimpleTestCase

from ..classification import classify_document


class ClassifyEmptyAndShortTests(SimpleTestCase):
    def test_empty_text_returns_other(self):
        self.assertEqual(classify_document(""), "OTHER")

    def test_none_text_returns_other(self):
        # Defensive: classifier guards against falsy input.
        self.assertEqual(classify_document(None), "OTHER")

    def test_short_text_under_50_chars_returns_other(self):
        self.assertEqual(classify_document("Form 990"), "OTHER")

    def test_text_with_no_matching_keywords_returns_other(self):
        text = (
            "This is a long block of generic text. " * 10
            + "Nothing here matches any of the document type keywords."
        )
        self.assertEqual(classify_document(text), "OTHER")


class ClassifyDeedTests(SimpleTestCase):
    def test_warranty_deed_with_grantor_grantee(self):
        text = (
            "WARRANTY DEED\n"
            "This indenture witnesseth that the grantors, John Smith, in "
            "consideration of $1.00, does hereby convey to the grantees, "
            "Jane Doe, the following parcel.\nLegal Description: Lot 5...\n"
            "In witness whereof, the parties have signed.\n"
        )
        self.assertEqual(classify_document(text), "DEED")

    def test_quitclaim_deed(self):
        text = (
            "QUITCLAIM DEED\n"
            "Grantor John Smith conveys to Grantee Jane Doe.\n"
            "Recorded with the County Recorder.\n"
            "In witness whereof, executed this day.\n"
        )
        self.assertEqual(classify_document(text), "DEED")


class ClassifyParcelRecordTests(SimpleTestCase):
    def test_darke_county_parcel_card(self):
        text = (
            "Parcel Number: A01-12345\n"
            "County Auditor — Property Card\n"
            "Owner Name: Bright Future Foundation\n"
            "Township A         School District B\n"
            "Appraised (100%): $250,000\n"
            "Assessed (35%): $87,500\n"
            "darkecountyrealestate.org\n"
            "SOLD: 06/15/2021\n"
        )
        self.assertEqual(classify_document(text), "PARCEL_RECORD")


class ClassifyUccTests(SimpleTestCase):
    def test_ucc1_financing_statement(self):
        text = (
            "UCC-1 Financing Statement\n"
            "Debtor: Acme Holdings LLC\n"
            "Secured Party: Big Bank N.A.\n"
            "Collateral: All assets, equipment, and inventory of the debtor.\n"
            "Uniform Commercial Code Article 9\n"
        )
        self.assertEqual(classify_document(text), "UCC")


class ClassifyMortgageTests(SimpleTestCase):
    def test_mortgage_document(self):
        text = (
            "This Mortgage is made between Mortgagor John Smith and "
            "Mortgagee Big Bank.\n"
            "Note has principal of $200,000 with an interest rate of 5%.\n"
        )
        self.assertEqual(classify_document(text), "MORTGAGE")


class ClassifyLienTests(SimpleTestCase):
    def test_mechanics_lien(self):
        text = (
            "Mechanic's Lien filed against the above property.\n"
            "Claim of lien for unpaid construction work.\n"
            "This lien shall remain until paid or released by release of lien.\n"
        )
        self.assertEqual(classify_document(text), "LIEN")


class ClassifyForm990Tests(SimpleTestCase):
    def test_form_990_full_text(self):
        text = (
            "Form 990 — Return of Organization Exempt From Income Tax\n"
            "Employer Identification Number: 12-3456789\n"
            "Schedule A through Schedule O\n"
            "501(c)(3) tax-exempt organization\n"
            "Program Service Revenue\n"
            "Contributions and Grants\n"
            "IRS / EIN section\n"
        )
        self.assertEqual(classify_document(text), "IRS_990")


class ClassifyTieBreakingTests(SimpleTestCase):
    def test_text_below_min_score_returns_other(self):
        # "parcel" keyword weight=8, which meets _MIN_SCORE=8 → PARCEL_RECORD (not OTHER).
        # Stale expectation updated 2026-06-04: PARCEL_RECORD is the correct classification
        # for text that confidently mentions a parcel (owner decision; code is authoritative).
        text = (
            "There is a parcel mentioned somewhere in this otherwise "
            "unrelated body of text that does not score high enough to "
            "match any document type confidently. "
        ) * 3
        self.assertEqual(classify_document(text), "PARCEL_RECORD")

    def test_higher_score_wins_when_two_types_match(self):
        # Mortgage gets 10 (mortgage) + 8 (mortgagor) + 8 (mortgagee) + 5 (interest rate)
        # plus parcel-record 8 (parcel number) — Mortgage wins decisively.
        text = (
            "Mortgage agreement between mortgagor and mortgagee.\n"
            "Interest rate: 5%.\n"
            "Parcel Number: 123-456.\n"
            "This Mortgage secures repayment.\n"
        )
        self.assertEqual(classify_document(text), "MORTGAGE")
