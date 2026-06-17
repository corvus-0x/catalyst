"""CI unit tests for the pure eval scorers (no DB, no Claude)."""

from types import SimpleNamespace
from unittest import TestCase

from investigations.tests.evals import lead_scorers
from investigations.tests.evals.lead_fixtures import GOLDEN_CASES


def _lead(title="Pattern", description="desc", narrative="why", doc_ids=("d1",)):
    """A duck-typed stand-in for a Finding the scorers can read."""
    return SimpleNamespace(
        title=title,
        description=description,
        narrative=narrative,
        evidence_snapshot={
            "doc_ref_resolution": {f"Doc-{i + 1}": d for i, d in enumerate(doc_ids)}
        },
    )


class CitationIntegrityTests(TestCase):
    def test_true_when_every_cited_doc_is_valid(self):
        leads = [_lead(doc_ids=("d1", "d2"))]
        self.assertTrue(lead_scorers.citation_integrity(leads, {"d1", "d2", "d3"}))

    def test_false_when_a_cited_doc_is_missing(self):
        leads = [_lead(doc_ids=("d1", "ghost"))]
        self.assertFalse(lead_scorers.citation_integrity(leads, {"d1"}))

    def test_true_for_no_leads(self):
        self.assertTrue(lead_scorers.citation_integrity([], {"d1"}))


class ForbiddenTermsTests(TestCase):
    def test_clean_when_no_accusatory_terms(self):
        self.assertTrue(lead_scorers.forbidden_terms_clean([_lead(description="anomalous timing")]))

    def test_dirty_when_accusatory_term_present(self):
        self.assertFalse(lead_scorers.forbidden_terms_clean([_lead(narrative="this is fraud")]))

    def test_word_boundary_does_not_flag_fraternity(self):
        self.assertTrue(
            lead_scorers.forbidden_terms_clean([_lead(description="college fraternity")])
        )


class FaithfulnessTests(TestCase):
    def test_all_supported_scores_one(self):
        leads = [_lead(), _lead()]
        score, flags = lead_scorers.faithfulness(leads, [True, True])
        self.assertEqual(score, 1.0)
        self.assertEqual(flags, [True, True])

    def test_half_supported_scores_half(self):
        score, _ = lead_scorers.faithfulness([_lead(), _lead()], [True, False])
        self.assertEqual(score, 0.5)

    def test_no_leads_scores_one_vacuously(self):
        score, flags = lead_scorers.faithfulness([], [])
        self.assertEqual(score, 1.0)
        self.assertEqual(flags, [])


class OverreachTests(TestCase):
    def test_none_overreach_scores_zero(self):
        score, flags = lead_scorers.overreach([_lead(), _lead()], [False, False])
        self.assertEqual(score, 0.0)
        self.assertEqual(flags, [False, False])

    def test_one_of_two_overreaches_scores_half(self):
        score, _ = lead_scorers.overreach([_lead(), _lead()], [True, False])
        self.assertEqual(score, 0.5)

    def test_no_leads_scores_zero(self):
        score, flags = lead_scorers.overreach([], [])
        self.assertEqual(score, 0.0)
        self.assertEqual(flags, [])


class FixtureShapeTests(TestCase):
    def test_fixture_ids_are_unique(self):
        ids = [fixture["id"] for fixture in GOLDEN_CASES]
        self.assertEqual(len(ids), len(set(ids)))

    def test_each_fixture_declares_thresholds(self):
        for fixture in GOLDEN_CASES:
            self.assertIn("expect_clean", fixture)
            self.assertIn("thresholds", fixture)
            self.assertIn("faithfulness", fixture["thresholds"])
            self.assertIn("overreach", fixture["thresholds"])
