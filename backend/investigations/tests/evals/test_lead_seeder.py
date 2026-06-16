"""CI unit test for the eval fixture seeder (DB, no Claude)."""

from django.test import TestCase

from investigations.models import Case, Document, FinancialSnapshot, Organization, Person
from investigations.tests.evals.lead_seeder import seed_case

_FIXTURE = {
    "id": "seeder_smoke",
    "case_name": "Eval — Seeder Smoke",
    "persons": [{"key": "sarah", "full_name": "Sarah Example", "role_tags": ["OFFICER"]}],
    "organizations": [
        {"key": "found", "name": "Example Foundation", "ein": "12-3456789", "org_type": "CHARITY"}
    ],
    "documents": [
        {
            "key": "doc990",
            "doc_type": "IRS_990",
            "filename": "2021_990.pdf",
            "extracted_text": "Gross receipts $1,200,000. President Sarah Example 0 0 0.",
        }
    ],
    "financial_snapshots": [
        {
            "org": "found",
            "doc": "doc990",
            "tax_year": 2021,
            "total_revenue": 1_200_000,
            "officer_compensation_total": 0,
        }
    ],
}


class SeedCaseTests(TestCase):
    def test_seeds_a_queryable_case_with_wired_fks(self):
        case = seed_case(_FIXTURE)

        self.assertIsInstance(case, Case)
        self.assertEqual(Person.objects.filter(case=case).count(), 1)
        self.assertEqual(Organization.objects.filter(case=case).count(), 1)
        self.assertEqual(Document.objects.filter(case=case).count(), 1)

        snap = FinancialSnapshot.objects.get(case=case)
        org = Organization.objects.get(case=case)
        doc = Document.objects.get(case=case)
        self.assertEqual(snap.organization_id, org.id)
        self.assertEqual(snap.document_id, doc.id)
        self.assertEqual(snap.total_revenue, 1_200_000)

    def test_distinct_documents_get_distinct_hashes(self):
        fixture = {
            **_FIXTURE,
            "documents": [
                {"key": "a", "doc_type": "DEED", "filename": "a.pdf", "extracted_text": "alpha"},
                {"key": "b", "doc_type": "DEED", "filename": "b.pdf", "extracted_text": "beta"},
            ],
            "financial_snapshots": [],
        }
        case = seed_case(fixture)
        hashes = list(Document.objects.filter(case=case).values_list("sha256_hash", flat=True))
        self.assertEqual(len(hashes), 2)
        self.assertEqual(len(hashes), len(set(hashes)))
