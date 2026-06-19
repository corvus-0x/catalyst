from django.test import TestCase

from investigations.case_map import (
    _new_evidence,
    build_case_map,
    pair_edge_id,
    score_evidence,
)
from investigations.models import (
    Case,
    Document,
    FindingStatus,
    Organization,
    OrganizationStatus,
    Person,
    PersonDocument,
    PersonOrganization,
)


def _doc(case, h):
    return Document.objects.create(
        case=case,
        filename="d.pdf",
        file_path="cases/t/d.pdf",
        sha256_hash=h * 64,
        file_size=1024,
    )


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


class ScoreEvidenceTests(TestCase):
    def test_co_mention_only_is_observed(self):
        ev = _new_evidence()
        ev["doc_ids"].add("d1")
        s = score_evidence(ev)
        self.assertEqual(s["score"], 10)
        self.assertEqual(s["level"], "observed")
        self.assertEqual(s["categories"], ["co_mentioned"])

    def test_single_role_is_documented(self):
        ev = _new_evidence()
        ev["role_count"] = 1
        self.assertEqual(score_evidence(ev)["level"], "documented")  # 30

    def test_doc_repetition_caps_at_20(self):
        ev = _new_evidence()
        for i in range(10):
            ev["doc_ids"].add(f"d{i}")
        # 10 + min(9*5, 20) = 30
        self.assertEqual(score_evidence(ev)["score"], 30)

    def test_transactions_cap_at_50(self):
        ev = _new_evidence()
        ev["transaction_count"] = 5
        self.assertEqual(score_evidence(ev)["score"], 50)  # min(5*25,50)
        self.assertEqual(score_evidence(ev)["level"], "repeated")

    def test_multiple_categories_reach_repeated(self):
        ev = _new_evidence()
        ev["role_count"] = 1  # 30
        ev["doc_ids"].add("d1")  # 10
        ev["transaction_count"] = 1  # 25  -> 65
        self.assertEqual(score_evidence(ev)["level"], "repeated")

    def test_high_raw_score_without_substantiated_thread_caps_at_repeated(self):
        ev = _new_evidence()
        ev["role_count"] = 1  # 30
        ev["transaction_count"] = 2  # 50 -> 80
        s = score_evidence(ev)
        self.assertGreaterEqual(s["score"], 80)
        self.assertEqual(s["level"], "repeated")  # capped: no substantiated thread

    def test_substantiated_thread_elevates_to_material(self):
        ev = _new_evidence()
        ev["role_count"] = 1  # 30
        ev["transaction_count"] = 2  # 50
        ev["thread_refs"].append(
            {"status": FindingStatus.CONFIRMED, "handoff_ready": False}
        )  # +25 -> 105, substantiated
        s = score_evidence(ev)
        self.assertEqual(s["level"], "material")
        self.assertEqual(s["substantiated_thread_count"], 1)
        self.assertFalse(s["handoff_included"])

    def test_handoff_thread_sets_handoff_included(self):
        ev = _new_evidence()
        ev["role_count"] = 1
        ev["transaction_count"] = 2
        ev["thread_refs"].append({"status": FindingStatus.CONFIRMED, "handoff_ready": True})  # +35
        s = score_evidence(ev)
        self.assertTrue(s["handoff_included"])
        self.assertEqual(s["level"], "material")


class CoMentionEdgeTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.a = Person.objects.create(case=self.case, full_name="A")
        self.b = Person.objects.create(case=self.case, full_name="B")

    def test_single_shared_doc_makes_one_observed_edge(self):
        d = _doc(self.case, "a")
        PersonDocument.objects.create(person=self.a, document=d)
        PersonDocument.objects.create(person=self.b, document=d)
        result = build_case_map(self.case)
        self.assertEqual(len(result["edges"]), 1)
        edge = result["edges"][0]
        lo, hi, eid = pair_edge_id(self.a.id, self.b.id)
        self.assertEqual(edge["id"], eid)
        self.assertEqual(edge["source"], lo)
        self.assertEqual(edge["target"], hi)
        self.assertEqual(edge["relationship"], "SUMMARY")
        self.assertEqual(edge["strength"]["level"], "observed")
        self.assertIn("co_mentioned", edge["strength"]["categories"])
        self.assertEqual(edge["strength"]["source_count"], 1)
        self.assertEqual(result["stats"]["by_level"]["observed"], 1)


class FormalRoleTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.p = Person.objects.create(case=self.case, full_name="Officer")
        self.o = Organization.objects.create(case=self.case, name="Org")

    def test_single_role_is_documented_edge(self):
        PersonOrganization.objects.create(person=self.p, org=self.o, role="Board member")
        result = build_case_map(self.case)
        self.assertEqual(len(result["edges"]), 1)
        s = result["edges"][0]["strength"]
        self.assertEqual(s["level"], "documented")
        self.assertEqual(s["role_count"], 1)
        self.assertIn("formal_role", s["categories"])
        self.assertEqual(result["edges"][0]["underlying_relationships"][0]["source"], "person_org")
