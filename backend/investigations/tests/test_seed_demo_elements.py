from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from investigations.case_map import build_case_map
from investigations.models import Case, Finding, FindingStatus, Property, ThreadElementType
from investigations.referral_grade import is_referral_grade, referral_grade_qs
from investigations.thread_elements import (
    finding_has_cited_assertion,
    finding_has_handoff_ready_assertion,
)


class SeedDemoElementsTests(TestCase):
    def test_flagship_thread_has_cited_and_handoff_assertions_and_keeps_narrative(self):
        call_command("seed_demo")
        confirmed = (
            Finding.objects.filter(status=FindingStatus.CONFIRMED).order_by("created_at").first()
        )
        self.assertIsNotNone(confirmed)
        self.assertTrue(finding_has_cited_assertion(confirmed))
        self.assertTrue(finding_has_handoff_ready_assertion(confirmed))
        self.assertTrue(confirmed.narrative.strip(), "legacy narrative retained for pre-4C PDF")


class SeedDemoSignalParityTests(TestCase):
    """Seeded findings must carry the same dedup identity live rules generate,
    so a public-demo 'Re-evaluate signals' click converges instead of duplicating."""

    def test_reevaluate_after_seed_creates_no_new_findings(self):
        call_command("seed_demo")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        before = Finding.objects.filter(case=case).count()
        url = reverse("api_case_reevaluate_findings", kwargs={"pk": case.pk})
        response = self.client.post(url)
        self.assertIn(response.status_code, (200, 201, 202))
        after = Finding.objects.filter(case=case).count()
        self.assertEqual(
            after,
            before,
            f"re-evaluation created {after - before} duplicate finding(s): "
            f"{list(Finding.objects.filter(case=case).values_list('rule_id', 'title'))}",
        )

    def test_elm_need_work_findings_are_uncited(self):
        """The Elm-property SR-003/SR-015 rows are deliberately need-work threads;
        the citation guard must keep them free of the Oak rows' document evidence."""
        call_command("seed_demo")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        prop_elm = Property.objects.get(case=case, parcel_number="R-2024-1456")
        for rule_id in ("SR-003", "SR-015"):
            elm_finding = Finding.objects.get(
                case=case, rule_id=rule_id, trigger_entity_id=prop_elm.id
            )
            self.assertEqual(
                elm_finding.document_links.count(),
                0,
                f"Elm {rule_id} row must stay uncited (need-work thread), but has "
                f"{elm_finding.document_links.count()} document link(s)",
            )


class SeedDemoReferralMixTests(TestCase):
    # 11 rule-backed (incl. Elm SR-003 and Elm SR-015) + 1 Lead finding
    EXPECTED_THREADS = 12

    def test_seed_produces_referral_mix_and_universal_elements(self):
        call_command("seed_demo")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        findings = Finding.objects.filter(case=case)
        self.assertEqual(findings.count(), self.EXPECTED_THREADS)
        self.assertEqual(referral_grade_qs(case).count(), 5)
        self.assertEqual(
            findings.count() - referral_grade_qs(case).count(),
            self.EXPECTED_THREADS - 5,
        )
        rule_backed = findings.exclude(rule_id="")
        for finding in rule_backed:
            self.assertTrue(
                finding.elements.exists(),
                f"{finding.rule_id} '{finding.title[:40]}' has no thread elements",
            )


class SeedDemoLeadStagingTests(TestCase):
    STAGED_RULES = ("SR-013", "SR-021")

    def test_staged_threads_have_freeform_material_and_document_links(self):
        call_command("seed_demo")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        for rule_id in self.STAGED_RULES:
            finding = Finding.objects.get(case=case, rule_id=rule_id)
            notes = finding.elements.filter(element_type=ThreadElementType.NOTE)
            questions = finding.elements.filter(element_type=ThreadElementType.QUESTION)
            self.assertGreaterEqual(notes.count(), 2, rule_id)
            self.assertGreaterEqual(questions.count(), 1, rule_id)
            self.assertTrue(
                finding.document_links.exists(),
                f"{rule_id}: staged Lead thread must link its evidence documents — "
                "build_thread_context puts document_links first in the prompt budget",
            )


class SeedDemoCaseMapTests(TestCase):
    def test_case_map_renders_all_three_evidence_categories(self):
        call_command("seed_demo")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        payload = build_case_map(case)
        categories = set()
        for edge in payload["edges"]:
            for ref in edge.get("evidence_refs", []):
                categories.add(ref.get("category"))
        for expected in ("transaction", "shared_address", "financial_link"):
            self.assertIn(expected, categories, f"no {expected} edge on the demo Case Map")


class SeedDemoResetTests(TestCase):
    def test_reset_twice_rebuilds_cleanly(self):
        call_command("seed_demo")
        call_command("seed_demo", "--reset")
        call_command("seed_demo", "--reset")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        self.assertTrue(Finding.objects.filter(case=case).exists())


class SeedDemoCanonicalPathTests(TestCase):
    """One thread must demonstrate the full chain: public record -> subject
    relationship -> Case Map edge -> cited assertion -> handoff-ready claim ->
    referral PDF. This is the demo spine the README walkthrough follows.

    Two SR-015 rows exist in the seed (Oak: CONFIRMED/referral-grade, Elm:
    NEW/SPECULATIVE) so the spine lookup is narrowed to the referral-grade
    (CONFIRMED) row rather than Finding.objects.get(case=case, rule_id="SR-015"),
    which would raise MultipleObjectsReturned.
    """

    def test_canonical_thread_walks_the_full_chain(self):
        call_command("seed_demo")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        spine = Finding.objects.filter(
            case=case, rule_id="SR-015", status=FindingStatus.CONFIRMED
        ).get()
        self.assertTrue(is_referral_grade(spine))
        self.assertTrue(
            spine.elements.filter(
                element_type=ThreadElementType.ASSERTION, citations__isnull=False
            ).exists()
        )
        self.assertTrue(
            spine.elements.filter(
                element_type=ThreadElementType.ASSERTION, handoff_ready=True
            ).exists()
        )
        payload = build_case_map(case)
        thread_edge_ids = {
            ref.get("thread_id") for edge in payload["edges"] for ref in edge.get("thread_refs", [])
        }
        self.assertIn(str(spine.id), thread_edge_ids, "SR-015 spine missing from Case Map")
        response = self.client.post(reverse("api_case_referral_pdf", kwargs={"pk": case.pk}))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"%PDF"))
