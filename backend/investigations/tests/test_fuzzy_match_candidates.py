"""Tests for FuzzyMatchCandidate persistence and the listing endpoint.

Before this work, fuzzy entity-match candidates were computed in
entity_resolution but discarded after a single log line. The
"human-in-the-loop entity resolution" claim only became true once these
were persisted into a queue investigators can review. (QA audit P1.)
"""

from django.test import Client, TestCase
from django.urls import reverse

from .. import entity_resolution
from ..models import (
    Case,
    Document,
    FuzzyMatchCandidate,
    FuzzyMatchStatus,
    OcrStatus,
    Organization,
    Person,
)


def _doc(case, filename="d.pdf"):
    return Document.objects.create(
        case=case,
        filename=filename,
        file_path=f"cases/{case.pk}/{filename}",
        sha256_hash=("a" * 64) if filename == "d.pdf" else ("b" * 64),
        file_size=1024,
        ocr_status=OcrStatus.COMPLETED,
    )


class FuzzyCandidatePersistenceTests(TestCase):
    """resolve_person/resolve_org now persist their FuzzyCandidate output."""

    def setUp(self):
        self.case = Case.objects.create(name="Fuzzy Case")
        self.doc = _doc(self.case)

    def test_resolve_person_persists_fuzzy_candidate_for_near_match(self):
        Person.objects.create(case=self.case, full_name="John Smith")

        # Run the full resolution pipeline so _persist_fuzzy_candidates fires.
        result = entity_resolution.resolve_all_entities(
            {
                "persons": [{"raw": "Jon Smith", "context": ""}],
                "orgs": [],
                "meta": {},
            },
            case=self.case,
            document=self.doc,
        )

        # The new "Jon Smith" was created (not silent-merged), but a fuzzy
        # candidate row should also exist pointing at the existing John Smith.
        self.assertEqual(result.persons_created, 1)
        candidates = FuzzyMatchCandidate.objects.filter(case=self.case)
        self.assertEqual(candidates.count(), 1)
        cand = candidates.first()
        self.assertEqual(cand.entity_type, "person")
        self.assertEqual(cand.incoming_raw, "Jon Smith")
        self.assertEqual(cand.existing_raw, "John Smith")
        self.assertEqual(cand.status, FuzzyMatchStatus.PENDING)
        self.assertEqual(cand.detected_in_document_id, self.doc.id)
        self.assertGreaterEqual(cand.similarity, 0.75)

    def test_resolve_org_persists_fuzzy_candidate(self):
        # "Acme Holdings, Inc" and "ACME Holdings Inc" normalize to the same
        # key ("acme holdings") via org-name normalization, so they exact-match
        # and no fuzzy candidate is created.  Use a genuine near-miss instead:
        # a one-character typo that survives normalization.
        Organization.objects.create(case=self.case, name="Sunrise Community Foundation")

        entity_resolution.resolve_all_entities(
            {
                "persons": [],
                "orgs": [{"raw": "Sunrise Community Foundaiton", "context": ""}],
                "meta": {},
            },
            case=self.case,
            document=self.doc,
        )

        candidates = FuzzyMatchCandidate.objects.filter(case=self.case, entity_type="organization")
        self.assertEqual(candidates.count(), 1)

    def test_no_candidate_when_exact_match(self):
        Person.objects.create(case=self.case, full_name="John Smith")

        entity_resolution.resolve_all_entities(
            {
                "persons": [{"raw": "John Smith", "context": ""}],
                "orgs": [],
                "meta": {},
            },
            case=self.case,
            document=self.doc,
        )

        self.assertEqual(FuzzyMatchCandidate.objects.count(), 0)

    def test_idempotent_on_reprocessing(self):
        """Running resolution twice with the same data must not duplicate rows.

        The (case, entity_type, existing_entity_id, incoming_normalized) unique
        constraint plus the update_or_create logic in _persist_fuzzy_candidates
        keeps a single row per fuzzy pair.
        """
        Person.objects.create(case=self.case, full_name="John Smith")
        payload = {
            "persons": [{"raw": "Jon Smith", "context": ""}],
            "orgs": [],
            "meta": {},
        }

        entity_resolution.resolve_all_entities(payload, case=self.case, document=self.doc)
        entity_resolution.resolve_all_entities(payload, case=self.case, document=self.doc)

        self.assertEqual(FuzzyMatchCandidate.objects.count(), 1)

    def test_resolved_candidates_not_overwritten_on_reprocessing(self):
        """A DISMISSED row stays DISMISSED even if the resolution path runs again."""
        Person.objects.create(case=self.case, full_name="John Smith")

        entity_resolution.resolve_all_entities(
            {
                "persons": [{"raw": "Jon Smith", "context": ""}],
                "orgs": [],
                "meta": {},
            },
            case=self.case,
            document=self.doc,
        )

        cand = FuzzyMatchCandidate.objects.get(case=self.case)
        cand.status = FuzzyMatchStatus.DISMISSED
        cand.save()

        # Reprocess the same document.
        entity_resolution.resolve_all_entities(
            {
                "persons": [{"raw": "Jon Smith", "context": ""}],
                "orgs": [],
                "meta": {},
            },
            case=self.case,
            document=self.doc,
        )

        cand.refresh_from_db()
        self.assertEqual(cand.status, FuzzyMatchStatus.DISMISSED)


class FuzzyCandidateEndpointTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="API Case")
        self.url = reverse("api_case_fuzzy_candidates", args=[self.case.pk])

    def _candidate(self, **overrides):
        defaults = {
            "case": self.case,
            "entity_type": "person",
            "incoming_raw": "Jon Smith",
            "incoming_normalized": "jon smith",
            "existing_entity_id": "00000000-0000-0000-0000-000000000001",
            "existing_raw": "John Smith",
            "similarity": 0.82,
            "status": FuzzyMatchStatus.PENDING,
        }
        defaults.update(overrides)
        return FuzzyMatchCandidate.objects.create(**defaults)

    def test_default_returns_only_pending(self):
        self._candidate(
            incoming_normalized="a", existing_entity_id="00000000-0000-0000-0000-0000000000a1"
        )
        self._candidate(
            incoming_normalized="b",
            existing_entity_id="00000000-0000-0000-0000-0000000000b1",
            status=FuzzyMatchStatus.MERGED,
        )

        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["status"], "PENDING")

    def test_status_all_returns_every_state(self):
        for i, status in enumerate(
            [FuzzyMatchStatus.PENDING, FuzzyMatchStatus.MERGED, FuzzyMatchStatus.DISMISSED]
        ):
            self._candidate(
                incoming_normalized=f"n{i}",
                existing_entity_id=f"00000000-0000-0000-0000-00000000000{i}",
                status=status,
            )

        response = self.client.get(self.url, data={"status": "all"})
        self.assertEqual(response.json()["count"], 3)

    def test_filter_by_entity_type(self):
        self._candidate(
            incoming_normalized="p",
            entity_type="person",
            existing_entity_id="00000000-0000-0000-0000-000000000aa1",
        )
        self._candidate(
            incoming_normalized="o",
            entity_type="organization",
            existing_entity_id="00000000-0000-0000-0000-000000000bb1",
        )

        response = self.client.get(self.url, data={"entity_type": "organization"})
        body = response.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["entity_type"], "organization")

    def test_404_for_unknown_case(self):
        import uuid

        response = self.client.get(reverse("api_case_fuzzy_candidates", args=[uuid.uuid4()]))
        self.assertEqual(response.status_code, 404)


class FuzzyCandidatePatchEndpointTests(TestCase):
    """PATCH /api/cases/<pk>/fuzzy-candidates/<id>/ resolves a candidate."""

    def setUp(self):
        import json as _json

        self.json = _json
        self.client = Client()
        self.case = Case.objects.create(name="PATCH Case")
        self.candidate = FuzzyMatchCandidate.objects.create(
            case=self.case,
            entity_type="person",
            incoming_raw="Jon Smith",
            incoming_normalized="jon smith",
            existing_entity_id="00000000-0000-0000-0000-000000000001",
            existing_raw="John Smith",
            similarity=0.82,
        )
        self.url = reverse(
            "api_case_fuzzy_candidate_detail",
            args=[self.case.pk, self.candidate.pk],
        )

    def _patch(self, body):
        return self.client.patch(
            self.url, data=self.json.dumps(body), content_type="application/json"
        )

    def test_accept_marks_candidate_merged(self):
        response = self._patch({"action": "accept"})
        self.assertEqual(response.status_code, 200)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.status, FuzzyMatchStatus.MERGED)
        self.assertIsNotNone(self.candidate.resolved_at)
        self.assertEqual(response.json()["status"], "MERGED")

    def test_dismiss_marks_candidate_dismissed(self):
        response = self._patch({"action": "dismiss"})
        self.assertEqual(response.status_code, 200)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.status, FuzzyMatchStatus.DISMISSED)
        self.assertIsNotNone(self.candidate.resolved_at)

    def test_invalid_action_returns_400(self):
        response = self._patch({"action": "frobnicate"})
        self.assertEqual(response.status_code, 400)

    def test_missing_action_returns_400(self):
        response = self._patch({})
        self.assertEqual(response.status_code, 400)

    def test_invalid_json_returns_400(self):
        response = self.client.patch(self.url, data="not json", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_already_resolved_returns_409(self):
        # First resolve once.
        self._patch({"action": "accept"})
        # Second attempt must 409 — investigators can't flip a resolved
        # candidate without going through an explicit reset action.
        response = self._patch({"action": "dismiss"})
        self.assertEqual(response.status_code, 409)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.status, FuzzyMatchStatus.MERGED)

    def test_404_when_candidate_belongs_to_different_case(self):
        other_case = Case.objects.create(name="Other Case")
        url = reverse(
            "api_case_fuzzy_candidate_detail",
            args=[other_case.pk, self.candidate.pk],
        )
        response = self.client.patch(
            url,
            data=self.json.dumps({"action": "accept"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)
