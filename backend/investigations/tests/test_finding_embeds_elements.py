from django.test import TestCase

from investigations.models import Case, Finding, GateVersion, ThreadElement, ThreadElementType
from investigations.serializers import serialize_finding


class FindingEmbedsElementsTests(TestCase):
    def test_finding_detail_includes_elements_and_gate_version(self):
        case = Case.objects.create(name="C")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T")
        ThreadElement.objects.create(
            finding=f, element_type=ThreadElementType.QUESTION, position=1, text="q"
        )
        ThreadElement.objects.create(
            finding=f, element_type=ThreadElementType.ASSERTION, position=0, text="a"
        )
        out = serialize_finding(f)
        self.assertEqual([e["element_type"] for e in out["elements"]], ["ASSERTION", "QUESTION"])
        self.assertEqual(out["gate_version"], GateVersion.ASSERTION_V1)
