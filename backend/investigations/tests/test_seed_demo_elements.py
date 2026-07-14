from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from investigations.models import Case, Finding, FindingStatus, Property
from investigations.referral_grade import referral_grade_qs
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
