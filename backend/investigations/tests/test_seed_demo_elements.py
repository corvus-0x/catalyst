from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from investigations.models import Case, Finding, FindingStatus
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
