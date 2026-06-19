from django.test import TestCase
from investigations.models import Case, Finding


class OverreachFieldTests(TestCase):
    def test_defaults_to_false(self):
        case = Case.objects.create(name="T")
        finding = Finding.objects.create(case=case, rule_id="MANUAL", title="A")
        self.assertFalse(finding.overreach_reviewed)
