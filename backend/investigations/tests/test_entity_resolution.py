"""Tests for entity_resolution core logic — resolve_person + resolve_org.

Validator-wiring is covered in test_entity_resolution_validation.py and
fuzzy-candidate persistence in test_fuzzy_match_candidates.py. This file
covers the resolution algorithm itself: exact-match tier, alias matching,
PersonDocument/OrgDocument link creation, and enrichment of existing
records with new fields.
"""

from django.test import TestCase

from .. import entity_resolution
from ..models import (
    Case,
    Document,
    OcrStatus,
    Organization,
    OrgDocument,
    Person,
    PersonDocument,
)


def _doc(case, filename="d.pdf"):
    return Document.objects.create(
        case=case,
        filename=filename,
        file_path=f"cases/{case.pk}/{filename}",
        sha256_hash=("a" * 32 + "b" * 32),
        file_size=1024,
        ocr_status=OcrStatus.COMPLETED,
    )


class ResolvePersonExactMatchTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="Resolve Person Case")
        self.doc = _doc(self.case)

    def test_creates_new_person_when_none_match(self):
        result = entity_resolution.resolve_person("John Smith", self.case)

        self.assertTrue(result.created)
        self.assertEqual(result.person.full_name, "John Smith")
        self.assertEqual(Person.objects.filter(case=self.case).count(), 1)

    def test_exact_match_reuses_existing(self):
        existing = Person.objects.create(case=self.case, full_name="John Smith")

        result = entity_resolution.resolve_person("John Smith", self.case)

        self.assertFalse(result.created)
        self.assertEqual(result.person.id, existing.id)
        self.assertEqual(Person.objects.filter(case=self.case).count(), 1)

    def test_case_insensitive_exact_match(self):
        existing = Person.objects.create(case=self.case, full_name="John Smith")

        result = entity_resolution.resolve_person("JOHN SMITH", self.case)

        self.assertFalse(result.created)
        self.assertEqual(result.person.id, existing.id)

    def test_inverted_form_matches_western(self):
        # Normalization handles "EXAMPLE, JOHN" ↔ "John Example".
        existing = Person.objects.create(case=self.case, full_name="John Example")

        result = entity_resolution.resolve_person("EXAMPLE, JOHN", self.case)

        self.assertFalse(result.created)
        self.assertEqual(result.person.id, existing.id)

    def test_alias_match_reuses_existing(self):
        existing = Person.objects.create(
            case=self.case,
            full_name="John A. Smith",
            aliases=["Johnny Smith", "J Smith"],
        )

        result = entity_resolution.resolve_person("johnny smith", self.case)

        self.assertFalse(result.created)
        self.assertEqual(result.person.id, existing.id)
        self.assertEqual(result.matched_alias, "Johnny Smith")

    def test_link_to_document_created_on_new_person(self):
        entity_resolution.resolve_person("John Smith", self.case, document=self.doc)

        link = PersonDocument.objects.filter(document=self.doc).first()
        self.assertIsNotNone(link)
        self.assertEqual(link.person.full_name, "John Smith")

    def test_link_to_document_idempotent_on_match(self):
        Person.objects.create(case=self.case, full_name="John Smith")

        # Resolve twice with the same document — only one link should result.
        entity_resolution.resolve_person("John Smith", self.case, document=self.doc)
        entity_resolution.resolve_person("John Smith", self.case, document=self.doc)

        self.assertEqual(PersonDocument.objects.filter(document=self.doc).count(), 1)

    def test_different_persons_different_cases_isolated(self):
        other_case = Case.objects.create(name="Other Case")
        Person.objects.create(case=other_case, full_name="John Smith")

        result = entity_resolution.resolve_person("John Smith", self.case)

        # Other case has John Smith but our case does not — must create.
        self.assertTrue(result.created)
        self.assertEqual(Person.objects.filter(case=self.case).count(), 1)
        self.assertEqual(Person.objects.filter(case=other_case).count(), 1)

    def test_empty_name_creates_minimal_record(self):
        result = entity_resolution.resolve_person("", self.case)
        # Empty input doesn't crash — gets a degenerate Person row.
        self.assertIsNotNone(result.person)


class ResolveOrgExactMatchTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="Resolve Org Case")
        self.doc = _doc(self.case)

    def test_creates_new_org_when_none_match(self):
        result = entity_resolution.resolve_org("Acme Holdings, Inc.", self.case)

        self.assertTrue(result.created)
        self.assertEqual(Organization.objects.filter(case=self.case).count(), 1)

    def test_exact_match_reuses_existing(self):
        existing = Organization.objects.create(case=self.case, name="Acme Holdings, Inc.")

        result = entity_resolution.resolve_org("Acme Holdings, Inc.", self.case)

        self.assertFalse(result.created)
        self.assertEqual(result.org.id, existing.id)

    def test_designator_variations_match(self):
        existing = Organization.objects.create(case=self.case, name="Acme Holdings")

        # "Acme Holdings, Inc." normalizes to the same key as "Acme Holdings".
        result = entity_resolution.resolve_org("Acme Holdings, Inc.", self.case)

        self.assertFalse(result.created)
        self.assertEqual(result.org.id, existing.id)

    def test_filler_word_variations_match(self):
        existing = Organization.objects.create(case=self.case, name="Doe Foundation")

        result = entity_resolution.resolve_org("The Doe Foundation", self.case)

        self.assertFalse(result.created)
        self.assertEqual(result.org.id, existing.id)

    def test_link_to_document_created(self):
        entity_resolution.resolve_org("Acme Holdings, Inc.", self.case, document=self.doc)

        link = OrgDocument.objects.filter(document=self.doc).first()
        self.assertIsNotNone(link)

    def test_ein_enriches_existing_match(self):
        existing = Organization.objects.create(case=self.case, name="Acme Holdings")
        # Organization.ein is CharField(null=True) with no default, so it
        # starts as None until enrichment fills it in.
        self.assertIsNone(existing.ein)

        entity_resolution.resolve_org("Acme Holdings", self.case, ein="12-3456789")

        existing.refresh_from_db()
        self.assertEqual(existing.ein, "12-3456789")

    def test_ein_attached_on_create(self):
        result = entity_resolution.resolve_org("New Org", self.case, ein="12-3456789")

        self.assertTrue(result.created)
        self.assertEqual(result.org.ein, "12-3456789")

    def test_isolation_across_cases(self):
        other_case = Case.objects.create(name="Other Case")
        Organization.objects.create(case=other_case, name="Acme Holdings")

        result = entity_resolution.resolve_org("Acme Holdings", self.case)

        self.assertTrue(result.created)
        self.assertEqual(Organization.objects.filter(case=self.case).count(), 1)
