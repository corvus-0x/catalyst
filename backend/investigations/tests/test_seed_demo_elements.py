from django.core.management import call_command
from django.test import TestCase

from investigations.models import Finding, FindingStatus
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
