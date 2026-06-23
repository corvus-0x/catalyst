from django.test import TestCase

from investigations.models import Case, Finding


class OverreachFieldTests(TestCase):
    def test_defaults_to_false(self):
        case = Case.objects.create(name="T")
        finding = Finding.objects.create(case=case, rule_id="MANUAL", title="A")
        self.assertFalse(finding.overreach_reviewed)

    def test_serializer_round_trips_overreach(self):
        from investigations.serializers import FindingUpdateSerializer, serialize_finding
        case = Case.objects.create(name="S")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="A")
        s = FindingUpdateSerializer(data={"overreach_reviewed": True}, instance=f)
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        f.refresh_from_db()
        self.assertTrue(f.overreach_reviewed)
        self.assertTrue(serialize_finding(f)["overreach_reviewed"])
