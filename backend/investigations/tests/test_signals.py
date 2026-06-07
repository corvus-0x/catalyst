"""
Tests for the Signal Detection Engine.

Covers:
  - Rule registry metadata (RULE_REGISTRY)
  - Each rule evaluator: SR-003, SR-004, SR-005, SR-006, SR-010 (KEPT rules only)
  - persist_signals() deduplication logic
  - serialize_finding() output structure
  - FindingUpdateSerializer validation and save
  - GET /api/cases/<pk>/findings/ (list, filters, pagination, sorting)
  - GET /api/cases/<pk>/findings/<finding_id>/ (detail)
  - PATCH /api/cases/<pk>/findings/<finding_id>/ (confirm, dismiss, escalate)
"""

import json
import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.test import Client, TestCase
from django.urls import reverse

from ..models import (
    Case,
    Document,
    FinancialInstrument,
    FinancialSnapshot,
    Finding,
    FindingSource,
    FindingStatus,
    InstrumentType,
    OcrStatus,
    Organization,
    Person,
    Property,
    ScheduleLTransaction,
    Severity,
)
from ..serializers import FindingUpdateSerializer, serialize_finding
from ..signal_rules import (
    RULE_REGISTRY,
    SignalTrigger,
    evaluate_case,
    evaluate_document,
    evaluate_sr003_valuation_anomaly,
    evaluate_sr004_ucc_burst,
    evaluate_sr005_zero_consideration,
    evaluate_sr006_990_schedule_l,
    evaluate_sr010_missing_990,
    evaluate_sr012_no_coi_policy,
    evaluate_sr013_zero_officer_pay,
    evaluate_sr015_insider_swap,
    evaluate_sr017_blanket_lien_charity,
    evaluate_sr021_revenue_spike,
    evaluate_sr024_charity_conduit,
    evaluate_sr025_990_denies_related_party,
    evaluate_sr025_schedule_l_network,
    evaluate_sr026_990_denies_contractors,
    evaluate_sr029_low_program_ratio,
    evaluate_sr030_schedule_l_disclosure,
    evaluate_xml_financial_snapshots,
    persist_signals,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_case(name="Test Case"):
    return Case.objects.create(name=name)


def _make_document(
    case, *, doc_type="OTHER", extracted_text=None, filename="doc.pdf", doc_subtype=""
):
    import hashlib

    # Derive a unique sha256 from (filename + extracted_text) so two docs in
    # the same case don't collide on the uq_documents_case_sha256 unique
    # constraint, even when both use the same filename (e.g. two yearly 990s
    # both named "990.pdf" but with different text content).
    content_key = f"{filename}:{extracted_text or ''}"
    sha256 = hashlib.sha256(content_key.encode()).hexdigest()
    return Document.objects.create(
        case=case,
        filename=filename,
        file_path=f"cases/{case.pk}/{filename}",
        sha256_hash=sha256,
        file_size=1024,
        doc_type=doc_type,
        ocr_status=OcrStatus.COMPLETED,
        extracted_text=extracted_text,
        doc_subtype=doc_subtype,
    )


def _make_person(case, full_name, *, date_of_death=None):
    return Person.objects.create(
        case=case,
        full_name=full_name,
        date_of_death=date_of_death,
    )


def _make_org(case, name, *, org_type="OTHER", formation_date=None):
    return Organization.objects.create(
        case=case,
        name=name,
        org_type=org_type,
        formation_date=formation_date,
    )


def _make_property(case, *, purchase_price=None, assessed_value=None, parcel_number="123"):
    return Property.objects.create(
        case=case,
        parcel_number=parcel_number,
        purchase_price=purchase_price,
        assessed_value=assessed_value,
    )


def _make_ucc(case, filing_number, filing_date):
    return FinancialInstrument.objects.create(
        case=case,
        instrument_type=InstrumentType.UCC_FILING,
        filing_number=filing_number,
        filing_date=filing_date,
    )


def _make_finding(case, rule_id="SR-003", severity=Severity.CRITICAL, status=FindingStatus.NEW):
    return Finding.objects.create(
        case=case,
        rule_id=rule_id,
        title=f"Test finding {rule_id}",
        severity=severity,
        status=status,
        source=FindingSource.AUTO,
    )


# ---------------------------------------------------------------------------
# Rule Registry
# ---------------------------------------------------------------------------


class RuleRegistryTests(TestCase):
    """Ensure all 14 KEPT SR rules are registered with correct severity values."""

    EXPECTED = {
        "SR-003": "HIGH",
        "SR-004": "HIGH",
        "SR-005": "HIGH",
        "SR-006": "HIGH",
        "SR-010": "MEDIUM",
    }

    def test_all_rules_present(self):
        for rule_id in self.EXPECTED:
            with self.subTest(rule_id=rule_id):
                self.assertIn(rule_id, RULE_REGISTRY)

    def test_rule_severities(self):
        for rule_id, expected_severity in self.EXPECTED.items():
            with self.subTest(rule_id=rule_id):
                self.assertEqual(RULE_REGISTRY[rule_id].severity, expected_severity)

    def test_rules_have_title_and_description(self):
        for rule_id, info in RULE_REGISTRY.items():
            with self.subTest(rule_id=rule_id):
                self.assertTrue(info.title, f"{rule_id} has empty title")
                self.assertTrue(info.description, f"{rule_id} has empty description")


# ---------------------------------------------------------------------------
# SR-003 — Valuation Anomaly
# ---------------------------------------------------------------------------


class SR003ValuationAnomalyTests(TestCase):
    def setUp(self):
        self.case = _make_case()

    def test_fires_when_purchase_price_exceeds_assessed_by_over_50pct(self):
        _make_property(
            self.case, purchase_price=Decimal("200000"), assessed_value=Decimal("100000")
        )

        result = evaluate_sr003_valuation_anomaly(self.case)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].rule_id, "SR-003")
        self.assertEqual(result[0].severity, "HIGH")  # from RULE_REGISTRY

    def test_fires_when_purchase_price_below_assessed_by_over_50pct(self):
        _make_property(self.case, purchase_price=Decimal("40000"), assessed_value=Decimal("100000"))

        result = evaluate_sr003_valuation_anomaly(self.case)

        self.assertEqual(len(result), 1)
        self.assertIn("below", result[0].detected_summary)

    def test_no_fire_when_deviation_exactly_50pct(self):
        # Exactly 50% — boundary should NOT fire (rule is >50%)
        _make_property(
            self.case, purchase_price=Decimal("150000"), assessed_value=Decimal("100000")
        )

        result = evaluate_sr003_valuation_anomaly(self.case)

        self.assertEqual(result, [])

    def test_no_fire_when_deviation_below_50pct(self):
        _make_property(
            self.case, purchase_price=Decimal("120000"), assessed_value=Decimal("100000")
        )

        result = evaluate_sr003_valuation_anomaly(self.case)

        self.assertEqual(result, [])

    def test_no_fire_when_assessed_value_is_zero(self):
        _make_property(self.case, purchase_price=Decimal("100000"), assessed_value=Decimal("0"))

        result = evaluate_sr003_valuation_anomaly(self.case)

        self.assertEqual(result, [])

    def test_no_fire_when_purchase_price_missing(self):
        _make_property(self.case, assessed_value=Decimal("100000"))

        result = evaluate_sr003_valuation_anomaly(self.case)

        self.assertEqual(result, [])

    def test_multiple_properties_each_produce_own_signal(self):
        _make_property(
            self.case,
            purchase_price=Decimal("200000"),
            assessed_value=Decimal("100000"),
            parcel_number="P1",
        )
        _make_property(
            self.case,
            purchase_price=Decimal("300000"),
            assessed_value=Decimal("100000"),
            parcel_number="P2",
        )

        result = evaluate_sr003_valuation_anomaly(self.case)

        self.assertEqual(len(result), 2)


# ---------------------------------------------------------------------------
# SR-004 — UCC Amendment Burst
# ---------------------------------------------------------------------------


class SR004UccBurstTests(TestCase):
    def setUp(self):
        self.case = _make_case()
        self.base = date(2022, 8, 2)
        # Exactly 16 chars so appended A/B/C fall beyond the [:16] slice,
        # ensuring all three instruments share the same group prefix.
        self.prefix = "OHF-202208020011"

    def _ucc(self, filing_number, offset_days):
        return _make_ucc(self.case, filing_number, self.base + timedelta(days=offset_days))

    def test_fires_when_three_same_prefix_same_day(self):
        # All three filings on the same calendar day → real 24-hour burst.
        self._ucc(f"{self.prefix}A", 0)
        self._ucc(f"{self.prefix}B", 0)
        self._ucc(f"{self.prefix}C", 0)

        result = evaluate_sr004_ucc_burst(self.case)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].rule_id, "SR-004")

    def test_no_fire_when_third_filing_next_day(self):
        # filing_date is a DateField. A filing at 23:59 today and another at
        # 00:01 tomorrow are two calendar days apart in the data; we cannot
        # distinguish a 2-minute gap from a 23-hour gap, so the conservative
        # rule is "same calendar day". This test pins the corrected semantic
        # — previously the rule fired on this with `abs(days) <= 1`, which
        # let in pairs as far as ~47 hours apart. (QA audit P1.)
        self._ucc(f"{self.prefix}A", 0)
        self._ucc(f"{self.prefix}B", 0)
        self._ucc(f"{self.prefix}C", 1)

        result = evaluate_sr004_ucc_burst(self.case)

        self.assertEqual(result, [])

    def test_no_fire_when_only_two_within_24h(self):
        self._ucc(f"{self.prefix}A", 0)
        self._ucc(f"{self.prefix}B", 0)

        result = evaluate_sr004_ucc_burst(self.case)

        self.assertEqual(result, [])

    def test_no_fire_when_three_spread_over_three_days(self):
        self._ucc(f"{self.prefix}A", 0)
        self._ucc(f"{self.prefix}B", 2)
        self._ucc(f"{self.prefix}C", 4)

        result = evaluate_sr004_ucc_burst(self.case)

        self.assertEqual(result, [])

    def test_no_fire_when_fewer_than_three_instruments_total(self):
        self._ucc(f"{self.prefix}A", 0)
        self._ucc(f"{self.prefix}B", 0)

        result = evaluate_sr004_ucc_burst(self.case)

        # Total < 3 threshold for even considering burst
        self.assertEqual(result, [])

    def test_different_prefixes_not_grouped_together(self):
        # Three instruments, but all different master filing numbers
        _make_ucc(self.case, "OHF-00000001A", self.base)
        _make_ucc(self.case, "OHF-00000002B", self.base)
        _make_ucc(self.case, "OHF-00000003C", self.base)

        result = evaluate_sr004_ucc_burst(self.case)

        self.assertEqual(result, [])


# ---------------------------------------------------------------------------
# SR-005 — Zero-Consideration Transfer
# ---------------------------------------------------------------------------


class SR005ZeroConsiderationTests(TestCase):
    def setUp(self):
        self.case = _make_case()

    def test_fires_on_deed_with_zero_dollar_consideration(self):
        doc = _make_document(
            self.case, doc_type="DEED", extracted_text="The consideration for this deed is $0.00."
        )

        result = evaluate_sr005_zero_consideration(self.case, doc)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].rule_id, "SR-005")

    def test_fires_on_deed_with_love_and_affection_language(self):
        doc = _make_document(
            self.case,
            doc_type="DEED",
            extracted_text="Transferred for love and affection between family members.",
        )

        result = evaluate_sr005_zero_consideration(self.case, doc)

        self.assertEqual(len(result), 1)

    def test_fires_on_deed_with_no_consideration_phrase(self):
        doc = _make_document(
            self.case, doc_type="DEED", extracted_text="Transfer made for no consideration."
        )

        result = evaluate_sr005_zero_consideration(self.case, doc)

        self.assertEqual(len(result), 1)

    def test_fires_on_recorder_instrument_doc_type(self):
        doc = _make_document(
            self.case,
            doc_type="RECORDER_INSTRUMENT",
            extracted_text="Nominal consideration only — $0.00 paid.",
        )

        result = evaluate_sr005_zero_consideration(self.case, doc)

        self.assertEqual(len(result), 1)

    def test_no_fire_on_non_deed_doc_type(self):
        doc = _make_document(
            self.case,
            doc_type="IRS_990",
            extracted_text="No consideration received for this transaction.",
        )

        result = evaluate_sr005_zero_consideration(self.case, doc)

        self.assertEqual(result, [])

    def test_no_fire_when_normal_consideration_in_deed(self):
        doc = _make_document(
            self.case,
            doc_type="DEED",
            extracted_text="For and in consideration of $250,000.00 paid.",
        )

        result = evaluate_sr005_zero_consideration(self.case, doc)

        self.assertEqual(result, [])

    def test_no_fire_when_no_text(self):
        doc = _make_document(self.case, doc_type="DEED", extracted_text=None)

        result = evaluate_sr005_zero_consideration(self.case, doc)

        self.assertEqual(result, [])


# ---------------------------------------------------------------------------
# SR-006 — IRS 990 Schedule L Missing
# ---------------------------------------------------------------------------


class SR006ScheduleLTests(TestCase):
    def setUp(self):
        self.case = _make_case()

    def test_fires_when_28a_yes_without_schedule_l(self):
        text = "Part IV Line 28a Yes — transactions with interested persons occurred."
        doc = _make_document(self.case, doc_type="IRS_990", extracted_text=text)

        result = evaluate_sr006_990_schedule_l(self.case, doc)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].rule_id, "SR-006")

    def test_no_fire_when_schedule_l_also_present(self):
        text = "Part IV 28a Yes. See Schedule L for detail."
        doc = _make_document(self.case, doc_type="IRS_990", extracted_text=text)

        result = evaluate_sr006_990_schedule_l(self.case, doc)

        self.assertEqual(result, [])

    def test_no_fire_on_non_990_doc_type(self):
        text = "Part IV 28a Yes — this is not a 990."
        doc = _make_document(self.case, doc_type="DEED", extracted_text=text)

        result = evaluate_sr006_990_schedule_l(self.case, doc)

        self.assertEqual(result, [])

    def test_no_fire_when_990_has_no_yes_pattern(self):
        text = "This form 990 does not indicate any interested person transactions."
        doc = _make_document(self.case, doc_type="IRS_990", extracted_text=text)

        result = evaluate_sr006_990_schedule_l(self.case, doc)

        self.assertEqual(result, [])

    def test_no_fire_when_no_text(self):
        doc = _make_document(self.case, doc_type="IRS_990", extracted_text=None)

        result = evaluate_sr006_990_schedule_l(self.case, doc)

        self.assertEqual(result, [])


# ---------------------------------------------------------------------------
# SR-010 — Missing 990
# ---------------------------------------------------------------------------


class SR010Missing990Tests(TestCase):
    def setUp(self):
        self.case = _make_case()

    def test_fires_when_charity_org_and_no_990_docs(self):
        _make_org(self.case, "Example Township Foundation", org_type="CHARITY")

        result = evaluate_sr010_missing_990(self.case)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].rule_id, "SR-010")
        self.assertIn("Example Township Foundation", result[0].detected_summary)

    def test_no_fire_when_charity_has_990_doc(self):
        _make_org(self.case, "Example Township Foundation", org_type="CHARITY")
        _make_document(self.case, doc_type="IRS_990", extracted_text="Form 990 filing.")

        result = evaluate_sr010_missing_990(self.case)

        self.assertEqual(result, [])

    def test_no_fire_when_no_charity_orgs(self):
        _make_org(self.case, "Some LLC", org_type="LLC")

        result = evaluate_sr010_missing_990(self.case)

        self.assertEqual(result, [])

    def test_one_signal_per_charity_org(self):
        _make_org(self.case, "Charity A", org_type="CHARITY")
        _make_org(self.case, "Charity B", org_type="CHARITY")

        result = evaluate_sr010_missing_990(self.case)

        self.assertEqual(len(result), 2)


# ---------------------------------------------------------------------------
# SR-013 — Zero Officer Pay at High Revenue (PDF text path)
# ---------------------------------------------------------------------------


class SR013ZeroOfficerPayTests(TestCase):
    def setUp(self):
        self.case = _make_case()

    def _make_990(self, text):
        return _make_document(
            self.case, doc_type="IRS_990", extracted_text=text, filename="990.pdf"
        )

    def test_fires_on_high_revenue_with_zero_officer_comp(self):
        # Gross receipts pattern + the explicit "0 0 0" triplet pattern.
        text = (
            "Form 990 — Return of Organization Exempt from Income Tax\n"
            "Gross receipts $ 750,000\n"
            "Section A. Officers, Directors, Trustees\n"
            "(1) JANE EXAMPLE\n"
            "President  40 0 0 0\n"
            "(2) JOHN EXAMPLE\n"
            "Treasurer  20 0 0 0\n"
        )
        doc = self._make_990(text)
        result = evaluate_sr013_zero_officer_pay(self.case, doc)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].rule_id, "SR-013")
        self.assertEqual(result[0].severity, "HIGH")

    def test_no_fire_below_revenue_threshold(self):
        text = "Form 990\nGross receipts $ 100,000\n(1) JANE EXAMPLE\nPresident 40 0 0 0\n"
        doc = self._make_990(text)
        self.assertEqual(evaluate_sr013_zero_officer_pay(self.case, doc), [])

    def test_no_fire_when_doc_is_not_a_990(self):
        text = "Gross receipts $ 750,000\n0 0 0"
        doc = _make_document(self.case, doc_type="DEED", extracted_text=text)
        self.assertEqual(evaluate_sr013_zero_officer_pay(self.case, doc), [])

    def test_no_fire_when_no_text(self):
        doc = _make_document(self.case, doc_type="IRS_990", extracted_text="")
        self.assertEqual(evaluate_sr013_zero_officer_pay(self.case, doc), [])


# ---------------------------------------------------------------------------
# SR-015 — Insider Property Swap
# ---------------------------------------------------------------------------


class SR015InsiderSwapTests(TestCase):
    """SR-015 fires when a property transaction has an insider (or someone
    related to an insider) on either side. Insider = officer/agent of any
    Organization in the case via PersonOrganization.
    """

    def setUp(self):
        from ..models import (
            PersonOrganization,
            PropertyTransaction,
            Relationship,
            TransactionPartyType,
        )

        self.PersonOrganization = PersonOrganization
        self.PropertyTransaction = PropertyTransaction
        self.Relationship = Relationship
        self.PartyType = TransactionPartyType

        self.case = _make_case()
        self.charity = _make_org(self.case, "Bright Future Foundation", org_type="CHARITY")
        # Officer of the charity → an "insider"
        self.officer = _make_person(self.case, "Sarah Insider")
        self.PersonOrganization.objects.create(
            person=self.officer, org=self.charity, role="PRESIDENT"
        )
        # Officer's spouse — counts as "related to insider" via Relationship
        self.spouse = _make_person(self.case, "Pat Insider")
        self.Relationship.objects.create(
            case=self.case,
            person_a=self.officer,
            person_b=self.spouse,
            relationship_type="SPOUSE",
        )
        self.unrelated = _make_person(self.case, "Random Bystander")

    def _make_txn(self, prop, *, buyer=None, seller=None):
        return self.PropertyTransaction.objects.create(
            property=prop,
            buyer_id=buyer.pk if buyer else None,
            buyer_type=self.PartyType.PERSON if buyer else "",
            buyer_name=buyer.full_name if buyer else "",
            seller_id=seller.pk if seller else None,
            seller_type=self.PartyType.PERSON if seller else "",
            seller_name=seller.full_name if seller else "",
            transaction_date=date(2023, 6, 1),
        )

    def test_fires_when_buyer_is_a_charity_officer(self):
        prop = _make_property(self.case, parcel_number="P1")
        self._make_txn(prop, buyer=self.officer, seller=self.unrelated)

        triggers = evaluate_sr015_insider_swap(self.case)

        self.assertEqual(len(triggers), 1)
        self.assertEqual(triggers[0].rule_id, "SR-015")
        self.assertEqual(triggers[0].severity, "CRITICAL")
        self.assertEqual(triggers[0].trigger_entity_type, "property")

    def test_fires_when_seller_is_related_to_charity_officer(self):
        prop = _make_property(self.case, parcel_number="P2")
        self._make_txn(prop, buyer=self.unrelated, seller=self.spouse)

        triggers = evaluate_sr015_insider_swap(self.case)

        self.assertEqual(len(triggers), 1)
        self.assertIn("related to insider", triggers[0].evidence["insider_links"][0])

    def test_no_fire_when_neither_party_is_insider(self):
        prop = _make_property(self.case, parcel_number="P3")
        outsider = _make_person(self.case, "Other Random")
        self._make_txn(prop, buyer=self.unrelated, seller=outsider)

        triggers = evaluate_sr015_insider_swap(self.case)

        self.assertEqual(triggers, [])

    def test_no_fire_when_case_has_no_insiders(self):
        # Different case with property/transactions but no PersonOrganization links.
        other_case = _make_case(name="No-Insider Case")
        prop = Property.objects.create(case=other_case, parcel_number="X")
        person = _make_person(other_case, "Lone Person")
        self.PropertyTransaction.objects.create(
            property=prop,
            buyer_id=person.pk,
            buyer_type=self.PartyType.PERSON,
            buyer_name="Lone Person",
            transaction_date=date(2023, 6, 1),
        )

        triggers = evaluate_sr015_insider_swap(other_case)

        self.assertEqual(triggers, [])

    def test_evidence_snapshot_captures_transaction_details(self):
        prop = _make_property(self.case, parcel_number="P4")
        txn = self._make_txn(prop, buyer=self.officer, seller=self.unrelated)

        triggers = evaluate_sr015_insider_swap(self.case)

        ev = triggers[0].evidence
        self.assertEqual(ev["transaction_id"], str(txn.pk))
        self.assertEqual(ev["property_id"], str(prop.pk))
        self.assertEqual(ev["buyer_name"], "Sarah Insider")
        self.assertTrue(ev["buyer_is_insider"])
        self.assertFalse(ev["seller_is_insider"])
        self.assertEqual(ev["transaction_date"], "2023-06-01")


# ---------------------------------------------------------------------------
# SR-021 — Revenue Spike (year-over-year >= 100%)
# ---------------------------------------------------------------------------


class SR021RevenueSpikeTests(TestCase):
    def setUp(self):
        from ..models import FinancialSnapshot

        self.FinancialSnapshot = FinancialSnapshot
        self.case = _make_case()
        self.org = _make_org(self.case, "Growing Charity", org_type="CHARITY")
        self.doc = _make_document(self.case)

    def _snap(self, *, tax_year, revenue):
        return self.FinancialSnapshot.objects.create(
            case=self.case,
            document=self.doc,
            organization=self.org,
            ein="12-3456789",
            tax_year=tax_year,
            total_revenue=revenue,
        )

    def test_fires_on_doubling_revenue(self):
        self._snap(tax_year=2022, revenue=100_000)
        self._snap(tax_year=2023, revenue=300_000)  # 200% growth

        triggers = evaluate_sr021_revenue_spike(self.case)

        self.assertEqual(len(triggers), 1)
        self.assertEqual(triggers[0].rule_id, "SR-021")
        self.assertEqual(triggers[0].severity, "HIGH")
        self.assertEqual(triggers[0].trigger_entity_type, "organization")

    def test_no_fire_on_modest_growth(self):
        self._snap(tax_year=2022, revenue=100_000)
        self._snap(tax_year=2023, revenue=150_000)  # 50% growth

        self.assertEqual(evaluate_sr021_revenue_spike(self.case), [])

    def test_no_fire_with_only_one_snapshot(self):
        self._snap(tax_year=2023, revenue=100_000)
        self.assertEqual(evaluate_sr021_revenue_spike(self.case), [])

    def test_no_fire_when_prior_revenue_zero(self):
        # Division-by-zero guard: prev.total_revenue must be > 0 to compute growth.
        self._snap(tax_year=2022, revenue=0)
        self._snap(tax_year=2023, revenue=500_000)
        self.assertEqual(evaluate_sr021_revenue_spike(self.case), [])

    def test_fires_per_organization_independently(self):
        # Each organization needs its own document to satisfy the
        # uniq_financial_snapshot_doc_year constraint (unique on document+year).
        other_org = _make_org(self.case, "Other Charity", org_type="CHARITY")
        other_doc = _make_document(self.case, filename="other_990.pdf")
        self.FinancialSnapshot.objects.create(
            case=self.case,
            document=other_doc,
            organization=other_org,
            ein="98-7654321",
            tax_year=2022,
            total_revenue=200_000,
        )
        self.FinancialSnapshot.objects.create(
            case=self.case,
            document=other_doc,
            organization=other_org,
            ein="98-7654321",
            tax_year=2023,
            total_revenue=600_000,  # 200%
        )
        # Plus a non-spiking org
        self._snap(tax_year=2022, revenue=500_000)
        self._snap(tax_year=2023, revenue=510_000)  # only 2% growth

        triggers = evaluate_sr021_revenue_spike(self.case)

        self.assertEqual(len(triggers), 1)


# ---------------------------------------------------------------------------
# SR-025 — 990 Denies Related-Party Transactions, Evidence Contradicts
# ---------------------------------------------------------------------------


class SR025FalseDisclosureTests(TestCase):
    """SR-025 fires when:
    (a) a 990 document text says 'No' to Line 28 (transactions with
        interested persons), AND
    (b) the case database contains property transactions involving the
        extended insider network of charity officers.
    """

    def setUp(self):
        from ..models import (
            PersonOrganization,
            PropertyTransaction,
            Relationship,
            TransactionPartyType,
        )

        self.PersonOrganization = PersonOrganization
        self.PropertyTransaction = PropertyTransaction
        self.Relationship = Relationship
        self.PartyType = TransactionPartyType

        self.case = _make_case()
        self.charity = _make_org(self.case, "Bright Future Foundation", org_type="CHARITY")
        self.officer = _make_person(self.case, "Sarah Officer")
        self.PersonOrganization.objects.create(
            person=self.officer, org=self.charity, role="PRESIDENT"
        )
        self.relative = _make_person(self.case, "Pat Officer")
        self.Relationship.objects.create(
            case=self.case,
            person_a=self.officer,
            person_b=self.relative,
            relationship_type="SPOUSE",
        )

    def _denial_doc(self):
        # Text containing the SR-025 line-28-No regex pattern.
        text = (
            "Part IV Checklist of Required Schedules\n"
            "28a Did the organization engage in a transaction with a current or "
            "former officer ... ?  No\n"
        )
        return _make_document(
            self.case,
            doc_type="IRS_990",
            extracted_text=text,
            filename="990.pdf",
        )

    def _make_insider_txn(self):
        prop = _make_property(self.case, parcel_number="P1")
        return self.PropertyTransaction.objects.create(
            property=prop,
            buyer_id=self.relative.pk,  # related to insider
            buyer_type=self.PartyType.PERSON,
            buyer_name=self.relative.full_name,
            seller_id=self.officer.pk,
            seller_type=self.PartyType.PERSON,
            seller_name=self.officer.full_name,
            transaction_date=date(2023, 6, 1),
        )

    def test_fires_when_990_denies_but_insider_txn_exists(self):
        self._denial_doc()
        self._make_insider_txn()

        triggers = evaluate_sr025_990_denies_related_party(self.case)

        self.assertEqual(len(triggers), 1)
        self.assertEqual(triggers[0].rule_id, "SR-025")
        self.assertEqual(triggers[0].severity, "CRITICAL")

    def test_no_fire_without_a_denial_doc(self):
        # Insider transaction exists, but no 990 denying it.
        self._make_insider_txn()
        self.assertEqual(evaluate_sr025_990_denies_related_party(self.case), [])

    def test_no_fire_without_insider_transactions(self):
        # 990 denies but no transactions in the database to contradict.
        self._denial_doc()
        self.assertEqual(evaluate_sr025_990_denies_related_party(self.case), [])

    def test_no_fire_when_case_has_no_charity_officers(self):
        # 990 denial + transaction, but the org isn't classified CHARITY.
        # Replace charity with non-charity org.
        self.PersonOrganization.objects.filter(person=self.officer).delete()
        self.charity.org_type = "OTHER"
        self.charity.save()
        self.PersonOrganization.objects.create(
            person=self.officer, org=self.charity, role="PRESIDENT"
        )
        self._denial_doc()
        self._make_insider_txn()

        self.assertEqual(evaluate_sr025_990_denies_related_party(self.case), [])

    def test_evidence_snapshot_includes_denial_doc_and_examples(self):
        doc = self._denial_doc()
        txn = self._make_insider_txn()

        triggers = evaluate_sr025_990_denies_related_party(self.case)

        ev = triggers[0].evidence
        self.assertEqual(ev["denial_doc_id"], str(doc.pk))
        self.assertEqual(ev["contradicting_transaction_count"], 1)
        self.assertEqual(len(ev["transaction_examples"]), 1)
        self.assertEqual(ev["transaction_examples"][0]["transaction_id"], str(txn.pk))


# ---------------------------------------------------------------------------
# SR-012 — No Conflict of Interest Policy
# ---------------------------------------------------------------------------


class SR012NoCoiPolicyTests(TestCase):
    def setUp(self):
        self.case = _make_case()

    def _make_990(self, text):
        return _make_document(
            self.case, doc_type="IRS_990", extracted_text=text, filename="990.pdf"
        )

    def test_fires_on_explicit_no_to_coi_question(self):
        text = (
            "Part VI Governance, Management, and Disclosure\n"
            "12a Did the organization have a written conflict of interest policy? No\n"
        )
        doc = self._make_990(text)

        triggers = evaluate_sr012_no_coi_policy(self.case, doc)

        self.assertEqual(len(triggers), 1)
        self.assertEqual(triggers[0].rule_id, "SR-012")
        self.assertEqual(triggers[0].severity, "HIGH")

    def test_fires_on_line_12a_no_pattern(self):
        # Even without the full "conflict of interest policy" wording, the
        # bare "12a ... No" pattern triggers (form numbering shorthand).
        text = "12a No"
        doc = self._make_990(text)
        self.assertEqual(len(evaluate_sr012_no_coi_policy(self.case, doc)), 1)

    def test_no_fire_when_policy_answer_is_yes(self):
        text = "12a Did the organization have a written conflict of interest policy? Yes"
        doc = self._make_990(text)
        self.assertEqual(evaluate_sr012_no_coi_policy(self.case, doc), [])

    def test_no_fire_for_non_990_doc(self):
        doc = _make_document(
            self.case,
            doc_type="DEED",
            extracted_text="conflict of interest policy ... No",
        )
        self.assertEqual(evaluate_sr012_no_coi_policy(self.case, doc), [])


# ---------------------------------------------------------------------------
# SR-017 — UCC Blanket Lien on Charity-Connected Entity
# ---------------------------------------------------------------------------


class SR017BlanketLienTests(TestCase):
    def setUp(self):
        from ..models import FinancialInstrument, InstrumentType, PersonOrganization

        self.FinancialInstrument = FinancialInstrument
        self.InstrumentType = InstrumentType
        self.PersonOrganization = PersonOrganization

        self.case = _make_case()
        self.charity = _make_org(self.case, "Bright Future", org_type="CHARITY")
        self.officer = _make_person(self.case, "Sarah Officer")
        self.PersonOrganization.objects.create(
            person=self.officer, org=self.charity, role="PRESIDENT"
        )

    def _lien(self, *, debtor=None, blanket=True, filing_number="OH-LIEN-001"):
        return self.FinancialInstrument.objects.create(
            case=self.case,
            instrument_type=self.InstrumentType.UCC_FILING,
            filing_number=filing_number,
            filing_date=date(2023, 1, 1),
            debtor_id=debtor.pk if debtor else None,
            collateral_description="All assets, equipment, inventory, accounts",
            is_blanket_lien=blanket,
        )

    def test_fires_on_blanket_lien_against_charity_officer(self):
        self._lien(debtor=self.officer)

        triggers = evaluate_sr017_blanket_lien_charity(self.case)

        self.assertEqual(len(triggers), 1)
        self.assertEqual(triggers[0].rule_id, "SR-017")
        self.assertEqual(triggers[0].trigger_entity_type, "financial_instrument")

    def test_no_fire_on_non_blanket_lien(self):
        self._lien(debtor=self.officer, blanket=False)
        self.assertEqual(evaluate_sr017_blanket_lien_charity(self.case), [])

    def test_no_fire_when_debtor_is_not_charity_connected(self):
        outsider = _make_person(self.case, "Random Outsider")
        self._lien(debtor=outsider)
        self.assertEqual(evaluate_sr017_blanket_lien_charity(self.case), [])

    def test_no_fire_when_no_blanket_liens_exist(self):
        self.assertEqual(evaluate_sr017_blanket_lien_charity(self.case), [])


# ---------------------------------------------------------------------------
# SR-024 — Charity Conduit (TransactionChain)
# ---------------------------------------------------------------------------


class SR024CharityConduitTests(TestCase):
    def setUp(self):
        from ..models import (
            PropertyTransaction,
            TransactionChain,
            TransactionChainLink,
            TransactionPartyType,
        )

        self.PropertyTransaction = PropertyTransaction
        self.TransactionChain = TransactionChain
        self.TransactionChainLink = TransactionChainLink
        self.PartyType = TransactionPartyType

        self.case = _make_case()
        self.prop = _make_property(self.case, parcel_number="P1")

    def _txn(self, *, date_, buyer_name, seller_name):
        return self.PropertyTransaction.objects.create(
            property=self.prop,
            buyer_id=None,
            buyer_type=self.PartyType.PERSON,
            buyer_name=buyer_name,
            seller_id=None,
            seller_type=self.PartyType.PERSON,
            seller_name=seller_name,
            transaction_date=date_,
        )

    def _build_chain(self, txns, *, label="Demo Chain"):
        chain = self.TransactionChain.objects.create(
            case=self.case,
            chain_type="INSIDER_SWAP",
            label=label,
            time_span_days=5,
        )
        for i, t in enumerate(txns, start=1):
            self.TransactionChainLink.objects.create(chain=chain, transaction=t, sequence_number=i)
        return chain

    def test_fires_on_two_step_insider_swap_chain(self):
        t1 = self._txn(date_=date(2023, 1, 1), buyer_name="Charity", seller_name="Seller")
        t2 = self._txn(date_=date(2023, 1, 6), buyer_name="Insider", seller_name="Charity")
        self._build_chain([t1, t2])

        triggers = evaluate_sr024_charity_conduit(self.case)

        self.assertEqual(len(triggers), 1)
        self.assertEqual(triggers[0].rule_id, "SR-024")
        self.assertEqual(triggers[0].trigger_entity_type, "property")

    def test_no_fire_on_single_link_chain(self):
        t1 = self._txn(date_=date(2023, 1, 1), buyer_name="Charity", seller_name="Seller")
        self._build_chain([t1])
        self.assertEqual(evaluate_sr024_charity_conduit(self.case), [])

    def test_no_fire_when_no_chains_exist(self):
        self.assertEqual(evaluate_sr024_charity_conduit(self.case), [])

    def test_only_evaluates_insider_swap_chain_type(self):
        t1 = self._txn(date_=date(2023, 1, 1), buyer_name="A", seller_name="B")
        t2 = self._txn(date_=date(2023, 2, 1), buyer_name="B", seller_name="C")
        chain = self.TransactionChain.objects.create(
            case=self.case,
            chain_type="OTHER",
            label="Other type",
            time_span_days=30,
        )
        self.TransactionChainLink.objects.create(chain=chain, transaction=t1, sequence_number=1)
        self.TransactionChainLink.objects.create(chain=chain, transaction=t2, sequence_number=2)

        self.assertEqual(evaluate_sr024_charity_conduit(self.case), [])


# ---------------------------------------------------------------------------
# SR-026 — 990 Denies Independent Contractors, Permits Show Otherwise
# ---------------------------------------------------------------------------


class SR026ContractorDenialTests(TestCase):
    def setUp(self):
        self.case = _make_case()

    def _make_990(self, text):
        return _make_document(
            self.case, doc_type="IRS_990", extracted_text=text, filename="990.pdf"
        )

    def _make_permit(self, text):
        return _make_document(
            self.case,
            doc_type="BUILDING_PERMIT",
            extracted_text=text,
            filename="permit.pdf",
        )

    def test_fires_when_990_denies_but_permits_exist(self):
        self._make_990("25a Compensation of independent contractors? No")
        self._make_permit("General Contractor: Acme Construction LLC")

        triggers = evaluate_sr026_990_denies_contractors(self.case)

        self.assertEqual(len(triggers), 1)
        self.assertEqual(triggers[0].rule_id, "SR-026")
        self.assertEqual(triggers[0].severity, "HIGH")

    def test_no_fire_without_990_denial(self):
        self._make_permit("Contractor: Acme Construction LLC")
        self.assertEqual(evaluate_sr026_990_denies_contractors(self.case), [])

    def test_no_fire_without_any_permits(self):
        self._make_990("25a No")
        self.assertEqual(evaluate_sr026_990_denies_contractors(self.case), [])

    def test_fires_per_denial_doc(self):
        # Two 990 filings denying contractors; one permit. Each filing is a
        # separate disclosure, so each triggers a distinct finding.
        self._make_990("25a No (year 1)")
        self._make_990("25a No (year 2)")
        self._make_permit("General Contractor: Acme")

        self.assertEqual(len(evaluate_sr026_990_denies_contractors(self.case)), 2)


# ---------------------------------------------------------------------------
# SR-029 — Low Program Expense Ratio (FinancialSnapshot path)
# ---------------------------------------------------------------------------


class SR029LowProgramRatioTests(TestCase):
    def setUp(self):
        from ..models import FinancialSnapshot

        self.FinancialSnapshot = FinancialSnapshot
        self.case = _make_case()
        self.org = _make_org(self.case, "Test Charity", org_type="CHARITY")
        self.doc = _make_document(self.case)

    def _snap(self, **kwargs):
        defaults = {
            "case": self.case,
            "document": self.doc,
            "organization": self.org,
            "ein": "12-3456789",
            "tax_year": 2023,
        }
        defaults.update(kwargs)
        return self.FinancialSnapshot.objects.create(**defaults)

    def test_fires_when_program_ratio_below_50pct(self):
        # total_expenses = 1M, salaries = 600k, fundraising = 100k → program = 300k = 30%
        self._snap(
            total_expenses=1_000_000,
            salaries_and_compensation=600_000,
            professional_fundraising=100_000,
            other_expenses=0,
        )

        triggers = evaluate_sr029_low_program_ratio(self.case)

        self.assertEqual(len(triggers), 1)
        self.assertEqual(triggers[0].rule_id, "SR-029")
        self.assertEqual(triggers[0].severity, "HIGH")
        self.assertEqual(triggers[0].trigger_entity_type, "organization")

    def test_no_fire_when_program_ratio_above_50pct(self):
        # 1M total, 200k salaries → 800k program = 80%
        self._snap(
            total_expenses=1_000_000,
            salaries_and_compensation=200_000,
            professional_fundraising=0,
            other_expenses=0,
        )
        self.assertEqual(evaluate_sr029_low_program_ratio(self.case), [])

    def test_no_fire_when_total_expenses_zero(self):
        self._snap(
            total_expenses=0,
            salaries_and_compensation=10_000,
            professional_fundraising=0,
            other_expenses=0,
        )
        self.assertEqual(evaluate_sr029_low_program_ratio(self.case), [])

    def test_no_fire_when_components_all_missing(self):
        # All three component fields are 0 → can't compute non-program total,
        # rule skips (avoid division-by-zero / unreliable signal).
        self._snap(
            total_expenses=1_000_000,
            salaries_and_compensation=0,
            professional_fundraising=0,
            other_expenses=0,
        )
        self.assertEqual(evaluate_sr029_low_program_ratio(self.case), [])


# ---------------------------------------------------------------------------
# persist_signals() — Deduplication
# ---------------------------------------------------------------------------


class PersistSignalsTests(TestCase):
    def setUp(self):
        self.case = _make_case()

    def _trigger(self, rule_id="SR-010", entity_id=None, doc=None):
        rule = RULE_REGISTRY[rule_id]
        return SignalTrigger(
            rule_id=rule_id,
            severity=rule.severity,
            title=rule.title,
            detected_summary="Test summary.",
            trigger_entity_id=entity_id,
            trigger_doc=doc,
        )

    def test_creates_new_finding(self):
        triggers = [self._trigger()]
        created = persist_signals(self.case, triggers)
        self.assertEqual(len(created), 1)
        self.assertEqual(Finding.objects.count(), 1)

    def test_deduplicates_against_existing_new_finding(self):
        # Pre-create a NEW finding with same rule_id
        Finding.objects.create(
            case=self.case,
            rule_id="SR-010",
            title="Test Finding",
            severity="MEDIUM",
            status=FindingStatus.NEW,
            source=FindingSource.AUTO,
        )
        triggers = [self._trigger()]
        created = persist_signals(self.case, triggers)
        self.assertEqual(created, [])
        self.assertEqual(Finding.objects.count(), 1)  # unchanged

    def test_does_not_deduplicate_against_dismissed_finding(self):
        # DISMISSED findings allow re-fire
        Finding.objects.create(
            case=self.case,
            rule_id="SR-010",
            title="Test Finding",
            severity="MEDIUM",
            status=FindingStatus.DISMISSED,
            source=FindingSource.AUTO,
        )
        triggers = [self._trigger()]
        created = persist_signals(self.case, triggers)
        self.assertEqual(len(created), 1)
        self.assertEqual(Finding.objects.count(), 2)

    def test_persisted_finding_has_correct_fields(self):
        org = _make_org(self.case, "Test Org")
        trigger = SignalTrigger(
            rule_id="SR-010",
            severity="MEDIUM",
            title="Test",
            detected_summary="No 990 found.",
            trigger_entity_id=org.pk,
            trigger_doc=None,
        )
        created = persist_signals(self.case, [trigger])
        finding = created[0]
        self.assertEqual(finding.rule_id, "SR-010")
        self.assertEqual(finding.severity, "MEDIUM")
        self.assertEqual(finding.status, FindingStatus.NEW)
        self.assertEqual(finding.description, "No 990 found.")
        self.assertEqual(finding.source, FindingSource.AUTO)
        self.assertIsNone(finding.trigger_doc_id)

    def test_empty_trigger_list_returns_empty(self):
        created = persist_signals(self.case, [])
        self.assertEqual(created, [])

    # Regression: dedup must key on (case, rule_id, trigger_entity_id), not
    # trigger_doc. Two transactions on the SAME insider but different
    # documents previously produced two findings; one transaction
    # re-evaluated with a different trigger_doc previously produced
    # duplicates. (QA audit P1 — persist_signals dedup key.)
    def test_dedup_keys_on_entity_not_document(self):
        org = _make_org(self.case, "Test Org")
        doc_a = _make_document(self.case, filename="a.pdf")
        doc_b = _make_document(self.case, filename="b.pdf")

        # Two triggers, same case + rule + entity, different documents.
        triggers = [
            SignalTrigger(
                rule_id="SR-010",
                severity="MEDIUM",
                title="x",
                detected_summary="y",
                trigger_entity_id=org.pk,
                trigger_entity_type="organization",
                trigger_doc=doc_a,
            ),
            SignalTrigger(
                rule_id="SR-010",
                severity="MEDIUM",
                title="x",
                detected_summary="y",
                trigger_entity_id=org.pk,
                trigger_entity_type="organization",
                trigger_doc=doc_b,
            ),
        ]
        created = persist_signals(self.case, triggers)

        # Same entity, same rule → exactly one Finding.
        self.assertEqual(len(created), 1)
        self.assertEqual(Finding.objects.filter(case=self.case).count(), 1)

    def test_different_entities_same_rule_create_separate_findings(self):
        org_a = _make_org(self.case, "Org A")
        org_b = _make_org(self.case, "Org B")
        triggers = [
            SignalTrigger(
                rule_id="SR-010",
                severity="MEDIUM",
                title="x",
                detected_summary="y",
                trigger_entity_id=org_a.pk,
                trigger_entity_type="organization",
            ),
            SignalTrigger(
                rule_id="SR-010",
                severity="MEDIUM",
                title="x",
                detected_summary="y",
                trigger_entity_id=org_b.pk,
                trigger_entity_type="organization",
            ),
        ]
        created = persist_signals(self.case, triggers)
        self.assertEqual(len(created), 2)

    # Regression: FindingEntity rows must be created so the relational
    # graph (referral PDF, entity views) picks up rule-derived findings.
    # Previously persist_signals only set trigger_entity_id on the Finding
    # row but never wrote a FindingEntity link. (QA audit P1.)
    def test_creates_finding_entity_link(self):
        from ..models import FindingEntity

        org = _make_org(self.case, "Test Org")
        trigger = SignalTrigger(
            rule_id="SR-010",
            severity="MEDIUM",
            title="x",
            detected_summary="y",
            trigger_entity_id=org.pk,
            trigger_entity_type="organization",
        )
        created = persist_signals(self.case, [trigger])
        self.assertEqual(len(created), 1)

        links = FindingEntity.objects.filter(finding=created[0])
        self.assertEqual(links.count(), 1)
        link = links.first()
        self.assertEqual(link.entity_id, org.pk)
        self.assertEqual(link.entity_type, "organization")

    # Regression: evidence_snapshot was always {} because persist_signals
    # never read trigger.evidence. The referral PDF and audit chain need
    # the structured inputs that triggered each rule to cite back to.
    # (QA audit P1.)
    def test_evidence_snapshot_is_persisted(self):
        org = _make_org(self.case, "Test Org")
        evidence = {
            "officers": [{"name": "Jane Doe", "comp": 0}],
            "total_revenue": 750000,
            "tax_year": 2023,
        }
        trigger = SignalTrigger(
            rule_id="SR-013",
            severity="HIGH",
            title=RULE_REGISTRY["SR-013"].title,
            detected_summary="zero officer pay at high revenue",
            trigger_entity_id=org.pk,
            trigger_entity_type="organization",
            evidence=evidence,
        )
        created = persist_signals(self.case, [trigger])
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0].evidence_snapshot, evidence)

    def test_evidence_snapshot_defaults_to_empty_dict(self):
        org = _make_org(self.case, "Test Org")
        trigger = SignalTrigger(
            rule_id="SR-010",
            severity="MEDIUM",
            title="x",
            detected_summary="y",
            trigger_entity_id=org.pk,
            trigger_entity_type="organization",
        )
        created = persist_signals(self.case, [trigger])
        self.assertEqual(created[0].evidence_snapshot, {})

    def test_no_finding_entity_link_when_type_missing(self):
        from ..models import FindingEntity

        # If the evaluator doesn't supply a trigger_entity_type we can't
        # safely create a FindingEntity row (entity_type is non-blank).
        # The Finding still persists, but no entity link is added.
        trigger = SignalTrigger(
            rule_id="SR-010",
            severity="MEDIUM",
            title="x",
            detected_summary="y",
            trigger_entity_id=uuid.uuid4(),
            trigger_entity_type=None,
        )
        created = persist_signals(self.case, [trigger])
        self.assertEqual(len(created), 1)
        self.assertEqual(FindingEntity.objects.filter(finding=created[0]).count(), 0)


# ---------------------------------------------------------------------------
# evaluate_xml_financial_snapshots — structured 990 XML rule evaluator
# ---------------------------------------------------------------------------


class XmlFinancialSnapshotsTests(TestCase):
    """The XML evaluator runs SR-006/012/013/028/029 on parsed 990 data."""

    def setUp(self):
        from ..models import FinancialSnapshot

        self.FinancialSnapshot = FinancialSnapshot
        self.case = _make_case()
        self.doc = _make_document(self.case)

    def _snapshot(self, raw):
        return self.FinancialSnapshot.objects.create(
            case=self.case,
            document=self.doc,
            ein="12-3456789",
            tax_year=raw.get("tax_year", 2023),
            source="IRS_TEOS_XML",
            raw_extraction=raw,
        )

    # Regression: previously the evaluator fired with rule_id="SR-025" on
    # material diversion, but SR-025 is "Denies Related-Party Transactions".
    # That mismatched the rule registry and broke any UI that joins on
    # rule_id. Now it fires SR-028. (QA audit P1.)
    def test_material_diversion_fires_sr028_not_sr025(self):
        self._snapshot(
            {
                "tax_year": 2023,
                "taxpayer_name": "Bright Future Foundation",
                "governance": {"material_diversion_or_misuse": True},
                "financials": {},
                "officers": [],
            }
        )

        triggers = evaluate_xml_financial_snapshots(self.case)

        rule_ids = [t.rule_id for t in triggers]
        self.assertIn("SR-028", rule_ids)
        self.assertNotIn("SR-025", rule_ids)
        sr028 = next(t for t in triggers if t.rule_id == "SR-028")
        # Title must come from the registry, not be free-form.
        self.assertEqual(sr028.title, RULE_REGISTRY["SR-028"].title)
        self.assertEqual(sr028.severity, "CRITICAL")
        # Evidence must capture the structured 990 fields the referral PDF
        # cites back to.
        self.assertEqual(sr028.evidence["material_diversion_or_misuse"], True)
        self.assertEqual(sr028.evidence["tax_year"], 2023)
        self.assertEqual(sr028.evidence["taxpayer_name"], "Bright Future Foundation")
        self.assertEqual(sr028.evidence["form_field"], "Form 990 Part VI Line 5")

    def test_no_material_diversion_no_sr028(self):
        self._snapshot(
            {
                "tax_year": 2023,
                "taxpayer_name": "Honest Charity",
                "governance": {"material_diversion_or_misuse": False},
                "financials": {},
                "officers": [],
            }
        )

        triggers = evaluate_xml_financial_snapshots(self.case)

        self.assertNotIn("SR-028", [t.rule_id for t in triggers])


# ---------------------------------------------------------------------------
# Regression: POST /api/cases/<pk>/fetch-990s/ must run the rules engine
# after creating FinancialSnapshots, otherwise the entire structured-XML
# rule path (SR-006/012/013/025/029) is silently dark on the most reliable
# data source. (QA audit P0 #1.)
# ---------------------------------------------------------------------------


class FetchNinetyNinesRunsRulesEngineTests(TestCase):
    def setUp(self):
        from unittest.mock import patch

        from ..irs_connector import (
            FinancialData,
            GovernanceData,
            IndexRecord,
            OfficerCompensation,
            Parsed990,
            SearchResult,
        )

        self.patch = patch
        self.IndexRecord = IndexRecord
        self.SearchResult = SearchResult
        self.Parsed990 = Parsed990
        self.FinancialData = FinancialData
        self.GovernanceData = GovernanceData
        self.OfficerCompensation = OfficerCompensation

        self.case = _make_case()
        # FinancialSnapshot.document is non-nullable, so the case needs at
        # least one Document for the endpoint to write snapshots.
        self.placeholder_doc = _make_document(self.case)

    def _filing(self):
        return self.IndexRecord(
            return_id="r1",
            filing_type="EFILE",
            ein="123456789",
            tax_period="202312",
            sub_date="2024",
            taxpayer_name="Bright Future Foundation",
            return_type="990",
            dln="d1",
            object_id="obj1",
            xml_batch_id="2024_TEOS_XML_01A",
            index_year=2024,
        )

    def _parsed_sr013_trigger(self):
        # Revenue >= 500k AND every officer reports $0 → triggers SR-013.
        return self.Parsed990(
            ein="123456789",
            taxpayer_name="Bright Future Foundation",
            tax_year=2023,
            return_type="990",
            financials=self.FinancialData(
                total_revenue=750_000,
                total_expenses=600_000,
            ),
            governance=self.GovernanceData(),
            officers=[
                self.OfficerCompensation(
                    name="Jane Doe",
                    title="Executive Director",
                    reportable_comp_from_org=0,
                    reportable_comp_from_related=0,
                    other_compensation=0,
                ),
                self.OfficerCompensation(
                    name="John Smith",
                    title="Treasurer",
                    reportable_comp_from_org=0,
                    reportable_comp_from_related=0,
                    other_compensation=0,
                ),
            ],
            parse_quality=1.0,
        )

    def test_fetch_990s_creates_finding_from_xml_rules(self):
        with (
            self.patch("investigations.irs_connector.search_990_by_ein") as mock_search,
            self.patch("investigations.irs_connector.fetch_990_xml") as mock_fetch,
            self.patch("investigations.irs_connector.parse_990_xml") as mock_parse,
        ):
            filing = self._filing()
            mock_search.return_value = self.SearchResult(
                ein="123456789",
                ein_formatted="12-3456789",
                filings=[filing],
                years_searched=[2024],
                total_found=1,
            )
            mock_fetch.return_value = "<Return />"
            mock_parse.return_value = self._parsed_sr013_trigger()

            response = self.client.post(
                reverse("api_case_fetch_990s", args=[self.case.pk]),
                data=json.dumps({"ein": "12-3456789"}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["fetched"], 1)

        # Sanity: the snapshot was persisted.
        from ..models import FinancialSnapshot

        self.assertEqual(FinancialSnapshot.objects.filter(case=self.case).count(), 1)

        # The actual fix assertion: the rules engine ran on the new snapshot
        # and produced a Finding for SR-013 (zero officer pay at high revenue).
        sr013 = Finding.objects.filter(case=self.case, rule_id="SR-013")
        self.assertEqual(
            sr013.count(),
            1,
            "fetch-990s did not invoke the rules engine — SR-013 never fired "
            "even though parsed XML matches its trigger conditions.",
        )


# ---------------------------------------------------------------------------
# serialize_signal()
# ---------------------------------------------------------------------------


class SerializeFindingTests(TestCase):
    def setUp(self):
        self.case = _make_case()

    def test_serialize_finding_includes_expected_keys(self):
        finding = _make_finding(self.case, rule_id="SR-003")
        data = serialize_finding(finding)
        expected_keys = {
            "id",
            "rule_id",
            "severity",
            "status",
            "title",
            "description",
            "narrative",
            "narrative_source",
            "narrative_updated_at",
            "evidence_weight",
            "source",
            "trigger_entity_id",
            "trigger_doc_id",
            "trigger_doc_filename",
            "investigator_note",
            "legal_refs",
            "evidence_snapshot",
            "ai_run_id",
            "entity_links",
            "document_links",
            "created_at",
            "updated_at",
        }
        self.assertEqual(set(data.keys()), expected_keys)

    def test_serialize_finding_title_comes_from_model(self):
        finding = _make_finding(self.case, rule_id="SR-003")
        data = serialize_finding(finding)
        self.assertEqual(data["title"], "Test finding SR-003")

    def test_serialize_finding_unknown_rule_id_uses_rule_id_as_title(self):
        finding = Finding.objects.create(
            case=self.case,
            rule_id="SR-999",
            title="SR-999",
            severity="MEDIUM",
            status=FindingStatus.NEW,
            source=FindingSource.AUTO,
        )
        data = serialize_finding(finding)
        self.assertEqual(data["title"], "SR-999")

    def test_serialize_finding_trigger_entity_id_is_string_or_none(self):
        entity_id = uuid.uuid4()
        finding = Finding.objects.create(
            case=self.case,
            rule_id="SR-010",
            title="Test",
            severity="MEDIUM",
            status=FindingStatus.NEW,
            source=FindingSource.AUTO,
            trigger_entity_id=entity_id,
        )
        data = serialize_finding(finding)
        self.assertEqual(data["trigger_entity_id"], str(entity_id))

    def test_serialize_finding_trigger_entity_id_none_when_not_set(self):
        finding = _make_finding(self.case)
        data = serialize_finding(finding)
        self.assertIsNone(data["trigger_entity_id"])


# ---------------------------------------------------------------------------
# SignalUpdateSerializer
# ---------------------------------------------------------------------------


class FindingUpdateSerializerTests(TestCase):
    def setUp(self):
        self.case = _make_case()
        self.finding = _make_finding(self.case, rule_id="SR-010")

    def test_confirm_finding(self):
        s = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=self.finding)
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, FindingStatus.CONFIRMED)

    def test_escalate_finding(self):
        s = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=self.finding)
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, FindingStatus.CONFIRMED)

    def test_dismiss_with_note(self):
        s = FindingUpdateSerializer(
            data={"status": "DISMISSED", "investigator_note": "Not relevant to this case."},
            instance=self.finding,
        )
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, FindingStatus.DISMISSED)
        self.assertEqual(self.finding.investigator_note, "Not relevant to this case.")

    def test_dismiss_without_note_is_invalid(self):
        s = FindingUpdateSerializer(data={"status": "DISMISSED"}, instance=self.finding)
        self.assertFalse(s.is_valid())
        self.assertIn("investigator_note", s.errors)

    def test_empty_payload_is_invalid(self):
        s = FindingUpdateSerializer(data={}, instance=self.finding)
        self.assertFalse(s.is_valid())
        self.assertIn("non_field_errors", s.errors)

    def test_invalid_status_value_is_rejected(self):
        s = FindingUpdateSerializer(data={"status": "ARCHIVED"}, instance=self.finding)
        self.assertFalse(s.is_valid())
        self.assertIn("status", s.errors)

    def test_unexpected_field_is_rejected(self):
        # "rule_id" is not in FindingUpdateSerializer.allowed_fields —
        # rule_id is immutable after creation. Severity was added to allowed
        # fields (it is now updatable), so "severity" no longer triggers this path.
        s = FindingUpdateSerializer(data={"rule_id": "SR-999"}, instance=self.finding)
        self.assertFalse(s.is_valid())
        self.assertIn("non_field_errors", s.errors)

    def test_no_instance_raises_error(self):
        s = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=None)
        self.assertFalse(s.is_valid())
        self.assertIn("non_field_errors", s.errors)

    def test_data_property_returns_serialized_finding(self):
        s = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=self.finding)
        s.is_valid()
        s.save()
        data = s.data
        self.assertIn("rule_id", data)
        self.assertEqual(data["status"], "CONFIRMED")


# ---------------------------------------------------------------------------
# Signal API — Collection (GET)
# ---------------------------------------------------------------------------


class FindingCollectionApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.case = _make_case()
        self.url = reverse("api_case_finding_collection", args=[self.case.pk])

    def test_returns_empty_list_when_no_findings(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 0)
        self.assertEqual(data["results"], [])

    def test_returns_all_findings_for_case(self):
        _make_finding(self.case, rule_id="SR-003")
        _make_finding(self.case, rule_id="SR-010")

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 2)

    def test_does_not_return_findings_from_other_cases(self):
        other_case = _make_case("Other Case")
        _make_finding(other_case, rule_id="SR-003")

        response = self.client.get(self.url)

        self.assertEqual(response.json()["count"], 0)

    def test_filters_by_status(self):
        _make_finding(self.case, rule_id="SR-003", status=FindingStatus.NEW)
        _make_finding(self.case, rule_id="SR-010", status=FindingStatus.DISMISSED)

        response = self.client.get(self.url, {"status": "NEW"})

        data = response.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["rule_id"], "SR-003")

    def test_filters_by_severity(self):
        _make_finding(self.case, rule_id="SR-003", severity=Severity.CRITICAL)
        _make_finding(self.case, rule_id="SR-010", severity=Severity.MEDIUM)

        response = self.client.get(self.url, {"severity": "CRITICAL"})

        self.assertEqual(response.json()["count"], 1)

    def test_rule_id_is_not_a_filter_param(self):
        # rule_id is not a supported query-param filter on this endpoint
        # (the API contract lists status/severity/source only). Passing it is
        # silently ignored — the endpoint returns all findings for the case.
        _make_finding(self.case, rule_id="SR-003")
        _make_finding(self.case, rule_id="SR-010")

        response = self.client.get(self.url, {"rule_id": "SR-010"})

        data = response.json()
        self.assertEqual(data["count"], 2)

    def test_invalid_status_filter_returns_empty(self):
        # The endpoint passes filter values directly to ORM .filter(); it does
        # not validate enum values. An unrecognised status matches nothing → 200
        # with count=0. (No 400 is issued for unrecognised filter values.)
        _make_finding(self.case, rule_id="SR-003")
        response = self.client.get(self.url, {"status": "INVALID"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 0)

    def test_invalid_severity_filter_returns_empty(self):
        # Same as above: unrecognised severity → 200 with count=0.
        _make_finding(self.case, rule_id="SR-003")
        response = self.client.get(self.url, {"severity": "EXTREME"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 0)

    def test_pagination_limit_offset(self):
        for i in range(5):
            _make_finding(self.case, rule_id="SR-010")

        response = self.client.get(self.url, {"limit": "2", "offset": "0"})

        data = response.json()
        self.assertEqual(data["count"], 5)
        self.assertEqual(len(data["results"]), 2)
        self.assertEqual(data["next_offset"], 2)

    def test_404_for_unknown_case(self):
        url = reverse("api_case_finding_collection", args=[uuid.uuid4()])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 404)

    def test_post_empty_payload_returns_400(self):
        # POST is allowed (creates a finding), but an empty payload fails
        # FindingIntakeSerializer validation → 400, not 405.
        response = self.client.post(self.url, data="{}", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_response_contains_expected_fields(self):
        _make_finding(self.case, rule_id="SR-003")

        response = self.client.get(self.url)

        result = response.json()["results"][0]
        for key in (
            "id",
            "rule_id",
            "severity",
            "status",
            "title",
            "description",
            "narrative",
            "evidence_weight",
            "source",
            "trigger_entity_id",
            "trigger_doc_id",
            "investigator_note",
            "legal_refs",
            "created_at",
        ):
            self.assertIn(key, result)


# ---------------------------------------------------------------------------
# Signal API — Detail (GET + PATCH)
# ---------------------------------------------------------------------------


class FindingDetailApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.case = _make_case()
        self.finding = _make_finding(self.case, rule_id="SR-005")
        self.url = reverse(
            "api_case_finding_detail",
            args=[self.case.pk, self.finding.pk],
        )

    def test_get_returns_finding(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["id"], str(self.finding.pk))
        self.assertEqual(data["rule_id"], "SR-005")

    def test_404_for_unknown_finding(self):
        url = reverse("api_case_finding_detail", args=[self.case.pk, uuid.uuid4()])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 404)

    def test_404_when_finding_belongs_to_different_case(self):
        other_case = _make_case("Other")
        other_finding = _make_finding(other_case, rule_id="SR-003")
        url = reverse("api_case_finding_detail", args=[self.case.pk, other_finding.pk])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 404)

    def test_patch_confirms_finding(self):
        response = self.client.patch(
            self.url,
            data=json.dumps({"status": "CONFIRMED"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, FindingStatus.CONFIRMED)

    def test_patch_needs_evidence_finding(self):
        response = self.client.patch(
            self.url,
            data=json.dumps({"status": "NEEDS_EVIDENCE"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, FindingStatus.NEEDS_EVIDENCE)

    def test_patch_dismisses_finding_with_note(self):
        response = self.client.patch(
            self.url,
            data=json.dumps(
                {
                    "status": "DISMISSED",
                    "investigator_note": "False positive — data entry error.",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, FindingStatus.DISMISSED)
        self.assertEqual(self.finding.investigator_note, "False positive — data entry error.")

    def test_patch_dismiss_without_note_returns_400(self):
        response = self.client.patch(
            self.url,
            data=json.dumps({"status": "DISMISSED"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("investigator_note", response.json()["errors"])

    def test_patch_invalid_status_returns_400(self):
        response = self.client.patch(
            self.url,
            data=json.dumps({"status": "ARCHIVED"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_patch_unexpected_field_returns_400(self):
        response = self.client.patch(
            self.url,
            data=json.dumps({"rule_id": "SR-999"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_patch_returns_updated_finding(self):
        response = self.client.patch(
            self.url,
            data=json.dumps({"status": "CONFIRMED"}),
            content_type="application/json",
        )
        data = response.json()
        self.assertEqual(data["status"], "CONFIRMED")
        self.assertEqual(data["id"], str(self.finding.pk))

    def test_delete_removes_finding(self):
        # DELETE is allowed on the finding detail endpoint and returns 204.
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 204)
        # Confirm the finding is gone.
        from ..models import Finding

        self.assertFalse(Finding.objects.filter(pk=self.finding.pk).exists())


# ---------------------------------------------------------------------------
# evaluate_document() integration
# ---------------------------------------------------------------------------


class EvaluateDocumentIntegrationTests(TestCase):
    """
    Smoke-test that evaluate_document() calls all four document-scoped rules
    in a single pass without errors.
    """

    def setUp(self):
        self.case = _make_case()

    def test_evaluate_document_runs_without_error_on_empty_case(self):
        doc = _make_document(self.case, doc_type="DEED", extracted_text="Transfer for $0.00.")
        result = evaluate_document(self.case, doc)
        # SR-005 should detect zero consideration
        rule_ids = {t.rule_id for t in result}
        self.assertIn("SR-005", rule_ids)

    def test_evaluate_case_runs_without_error_on_empty_case(self):
        result = evaluate_case(self.case)
        self.assertIsInstance(result, list)

    def test_evaluate_document_returns_list(self):
        doc = _make_document(self.case, extracted_text=None)
        result = evaluate_document(self.case, doc)
        self.assertIsInstance(result, list)


class SR030ScheduleLDisclosureTests(TestCase):
    """SR-030 fires when ScheduleLTransaction rows with amount > 0 exist."""

    def setUp(self):
        self.case = _make_case()
        self.doc = _make_document(self.case, doc_type="IRS_990")
        self.snap = FinancialSnapshot.objects.create(
            case=self.case,
            document=self.doc,
            tax_year=2022,
            ein="82-0045001",
            total_revenue=1_000_000,
        )

    def _make_txn(self, amount):
        return ScheduleLTransaction.objects.create(
            snapshot=self.snap,
            case=self.case,
            tax_year=2022,
            party_name="Jay Example",
            relationship_description="Officer",
            transaction_description="Lease",
            amount=amount,
        )

    def test_fires_when_transaction_with_amount_exists(self):
        self._make_txn(24000)
        triggers = evaluate_sr030_schedule_l_disclosure(self.case)
        self.assertEqual(len(triggers), 1)
        self.assertEqual(triggers[0].rule_id, "SR-030")
        self.assertEqual(triggers[0].severity, "HIGH")
        self.assertIn("Jay Example", triggers[0].detected_summary)
        self.assertIn("24,000", triggers[0].detected_summary)

    def test_does_not_fire_with_no_transactions(self):
        triggers = evaluate_sr030_schedule_l_disclosure(self.case)
        self.assertEqual(triggers, [])

    def test_does_not_fire_when_amount_is_null(self):
        self._make_txn(None)
        triggers = evaluate_sr030_schedule_l_disclosure(self.case)
        self.assertEqual(triggers, [])

    def test_evidence_snapshot_contains_transaction_details(self):
        self._make_txn(50000)
        triggers = evaluate_sr030_schedule_l_disclosure(self.case)
        ev = triggers[0].evidence
        self.assertEqual(ev["transactions"][0]["party_name"], "Jay Example")
        self.assertEqual(ev["transactions"][0]["amount"], 50000)


class SR031ZeroIndependentMembersTests(TestCase):
    """SR-031 fires when num_independent_members=0 and total_revenue > 250,000."""

    def setUp(self):
        self.case = _make_case()
        self.doc = _make_document(self.case, doc_type="IRS_990")

    def _make_snap(self, independent_members, revenue, source="IRS_TEOS_XML"):
        return FinancialSnapshot.objects.create(
            case=self.case,
            document=self.doc,
            tax_year=2022,
            ein="82-0045001",
            num_independent_members=independent_members,
            total_revenue=revenue,
            source=source,
            raw_extraction={
                "governance": {"independent_voting_members": independent_members},
                "financials": {"total_revenue": revenue},
                "tax_year": 2022,
                "taxpayer_name": "Test Org",
            },
        )

    def test_fires_when_zero_independent_and_high_revenue(self):
        self._make_snap(independent_members=0, revenue=500_000)
        triggers = evaluate_xml_financial_snapshots(self.case)
        sr031 = [t for t in triggers if t.rule_id == "SR-031"]
        self.assertEqual(len(sr031), 1)
        self.assertIn("0 independent", sr031[0].detected_summary)

    def test_does_not_fire_when_has_independent_members(self):
        self._make_snap(independent_members=3, revenue=500_000)
        triggers = evaluate_xml_financial_snapshots(self.case)
        sr031 = [t for t in triggers if t.rule_id == "SR-031"]
        self.assertEqual(sr031, [])

    def test_does_not_fire_below_revenue_threshold(self):
        self._make_snap(independent_members=0, revenue=100_000)
        triggers = evaluate_xml_financial_snapshots(self.case)
        sr031 = [t for t in triggers if t.rule_id == "SR-031"]
        self.assertEqual(sr031, [])

    def test_does_not_fire_when_independent_members_is_null(self):
        self._make_snap(independent_members=None, revenue=500_000)
        triggers = evaluate_xml_financial_snapshots(self.case)
        sr031 = [t for t in triggers if t.rule_id == "SR-031"]
        self.assertEqual(sr031, [])


class SR025ScheduleLContradictionTests(TestCase):
    """
    SR-025 contradiction mode: org told IRS 'no related-party txns'
    but ScheduleLTransaction rows say otherwise.
    """

    def setUp(self):
        self.case = _make_case()
        self.doc = _make_document(self.case, doc_type="IRS_990")
        self.snap = FinancialSnapshot.objects.create(
            case=self.case,
            document=self.doc,
            tax_year=2022,
            ein="82-0045001",
            related_party_disclosed=False,   # org said "No" to Part IV Line 28
            source="IRS_TEOS_XML",
            raw_extraction={
                "governance": {"schedule_l_required": False},
                "financials": {},
                "officers": [],
                "tax_year": 2022,
                "taxpayer_name": "Test Charity",
            },
        )

    def _make_txn(self, amount):
        return ScheduleLTransaction.objects.create(
            snapshot=self.snap,
            case=self.case,
            tax_year=2022,
            party_name="Jay Example",
            relationship_description="Officer",
            transaction_description="Lease",
            amount=amount,
        )

    def test_contradiction_fires_when_disclosure_false_but_txns_exist(self):
        self._make_txn(24000)
        triggers = evaluate_xml_financial_snapshots(self.case)
        sr025 = [t for t in triggers if t.rule_id == "SR-025"]
        self.assertGreaterEqual(len(sr025), 1)
        contradiction = next(
            (t for t in sr025 if "contradiction" in t.detected_summary.lower()
             or "Schedule L" in t.detected_summary),
            None,
        )
        self.assertIsNotNone(contradiction, "Expected a Schedule L contradiction trigger")
        self.assertEqual(contradiction.severity, "CRITICAL")
        ev = contradiction.evidence
        self.assertIn("contradiction_transactions", ev)
        self.assertEqual(ev["contradiction_transactions"][0]["party_name"], "Jay Example")

    def test_does_not_fire_when_related_party_disclosed_true(self):
        self.snap.related_party_disclosed = True
        self.snap.save(update_fields=["related_party_disclosed"])
        self._make_txn(24000)
        triggers = evaluate_xml_financial_snapshots(self.case)
        sr025_contr = [
            t for t in triggers if t.rule_id == "SR-025"
            and "contradiction" in t.detected_summary.lower()
        ]
        self.assertEqual(sr025_contr, [])

    def test_does_not_fire_when_no_schedule_l_rows(self):
        # No ScheduleLTransaction rows — no contradiction to detect
        triggers = evaluate_xml_financial_snapshots(self.case)
        sr025_contr = [
            t for t in triggers if t.rule_id == "SR-025"
            and "Schedule L" in t.detected_summary
        ]
        self.assertEqual(sr025_contr, [])


class SR025ScheduleLNetworkTests(TestCase):
    """SR-025 network mode: Schedule L party name matches a Person or Org in case."""

    def setUp(self):
        self.case = _make_case()
        self.doc = _make_document(self.case, doc_type="IRS_990")
        self.snap = FinancialSnapshot.objects.create(
            case=self.case,
            document=self.doc,
            tax_year=2022,
            ein="82-0045001",
            source="IRS_TEOS_XML",
            raw_extraction={},
        )

    def _make_txn(self, party_name, amount=24000):
        return ScheduleLTransaction.objects.create(
            snapshot=self.snap,
            case=self.case,
            tax_year=2022,
            party_name=party_name,
            relationship_description="Officer",
            transaction_description="Lease",
            amount=amount,
        )

    def test_fires_when_party_matches_person(self):
        person = _make_person(self.case, "Jay Example")
        self._make_txn("Jay Example")  # exact match
        triggers = evaluate_sr025_schedule_l_network(self.case)
        self.assertEqual(len(triggers), 1)
        self.assertEqual(triggers[0].rule_id, "SR-025")
        self.assertEqual(triggers[0].severity, "CRITICAL")
        self.assertEqual(triggers[0].trigger_entity_id, person.pk)
        self.assertIn("Jay Example", triggers[0].detected_summary)

    def test_does_not_fire_on_low_similarity(self):
        _make_person(self.case, "Ronald Smith")  # completely different name
        self._make_txn("Jay Example")
        triggers = evaluate_sr025_schedule_l_network(self.case)
        self.assertEqual(triggers, [])

    def test_fires_when_party_matches_organization(self):
        org = _make_org(self.case, "Example Farms LLC")
        self._make_txn("Example Farms LLC")
        triggers = evaluate_sr025_schedule_l_network(self.case)
        self.assertEqual(len(triggers), 1)
        self.assertEqual(triggers[0].trigger_entity_id, org.pk)

    def test_does_not_fire_when_no_schedule_l_rows(self):
        _make_person(self.case, "Jay Example")
        triggers = evaluate_sr025_schedule_l_network(self.case)
        self.assertEqual(triggers, [])


class SR028ScheduleOEnrichmentTests(TestCase):
    """SR-028 evidence_snapshot includes Schedule O explanation when available."""

    def setUp(self):
        self.case = _make_case()
        self.doc = _make_document(self.case, doc_type="IRS_990")

    def _make_snap(self, schedule_o_explanations=None):
        return FinancialSnapshot.objects.create(
            case=self.case,
            document=self.doc,
            tax_year=2022,
            ein="82-0045001",
            source="IRS_TEOS_XML",
            schedule_o_explanations=schedule_o_explanations or [],
            raw_extraction={
                "governance": {"material_diversion_or_misuse": True},
                "financials": {},
                "officers": [],
                "tax_year": 2022,
                "taxpayer_name": "Test Charity",
            },
        )

    def test_sr028_includes_schedule_o_text_in_evidence(self):
        self._make_snap(schedule_o_explanations=[
            {
                "form_line_reference": "Part VI Line 5",
                "explanation_text": "The organization became aware of a $50,000 diversion.",
            }
        ])
        triggers = evaluate_xml_financial_snapshots(self.case)
        sr028 = [t for t in triggers if t.rule_id == "SR-028"]
        self.assertEqual(len(sr028), 1)
        ev = sr028[0].evidence
        self.assertIn("schedule_o_explanation", ev)
        self.assertIn("50,000 diversion", ev["schedule_o_explanation"])

    def test_sr028_still_fires_without_schedule_o(self):
        self._make_snap(schedule_o_explanations=[])
        triggers = evaluate_xml_financial_snapshots(self.case)
        sr028 = [t for t in triggers if t.rule_id == "SR-028"]
        self.assertEqual(len(sr028), 1)
        ev = sr028[0].evidence
        self.assertNotIn("schedule_o_explanation", ev)

    def test_sr028_summary_quotes_schedule_o_when_available(self):
        self._make_snap(schedule_o_explanations=[
            {
                "form_line_reference": "Part VI Line 5",
                "explanation_text": "Unauthorized withdrawal detected.",
            }
        ])
        triggers = evaluate_xml_financial_snapshots(self.case)
        sr028 = [t for t in triggers if t.rule_id == "SR-028"]
        self.assertIn("Schedule O states", sr028[0].detected_summary)
        self.assertIn("Unauthorized withdrawal", sr028[0].detected_summary)
