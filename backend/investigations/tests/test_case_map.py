from django.test import TestCase

from investigations.case_map import build_case_map, pair_edge_id
from investigations.models import Case, Organization, OrganizationStatus, Person


class CaseMapSubjectTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.p = Person.objects.create(case=self.case, full_name="Jay Example")
        self.o = Organization.objects.create(
            case=self.case, name="Example Charity", status=OrganizationStatus.UNKNOWN
        )

    def test_subjects_become_nodes_with_flags_and_no_edges(self):
        result = build_case_map(self.case)
        self.assertEqual(result["case_id"], str(self.case.id))
        ids = {n["id"]: n for n in result["nodes"]}
        self.assertIn(str(self.p.id), ids)
        self.assertEqual(ids[str(self.p.id)]["type"], "person")
        self.assertEqual(ids[str(self.p.id)]["label"], "Jay Example")
        # org with UNKNOWN registration status — neutral data-completeness flag
        self.assertTrue(ids[str(self.o.id)]["flags"]["status_unknown"])
        self.assertEqual(result["edges"], [])
        self.assertEqual(result["stats"]["subject_count"], 2)
        self.assertEqual(result["stats"]["edge_count"], 0)
        self.assertEqual(
            result["stats"]["by_level"],
            {"observed": 0, "documented": 0, "repeated": 0, "material": 0},
        )

    def test_pair_edge_id_is_order_independent(self):
        a, b = "ffff", "0000"
        self.assertEqual(pair_edge_id(a, b), pair_edge_id(b, a))
        lo, hi, eid = pair_edge_id(a, b)
        self.assertEqual((lo, hi, eid), ("0000", "ffff", "0000__ffff"))
