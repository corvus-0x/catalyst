import json
import uuid

from django.test import TestCase
from django.urls import reverse

from investigations.case_map import (
    _new_evidence,
    build_case_map,
    pair_edge_id,
    score_evidence,
)
from investigations.models import (
    Case,
    Document,
    EvidenceWeight,
    Finding,
    FindingDocument,
    FindingEntity,
    FindingStatus,
    Organization,
    OrganizationStatus,
    OrgDocument,
    Person,
    PersonDocument,
    PersonOrganization,
    Property,
    PropertyTransaction,
    Relationship,
    ThreadElement,
    ThreadElementCitation,
    ThreadElementType,
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
        # reasons is the user-facing truth (spec §4) — assert its content, not just presence
        self.assertIn("Appears together in 1 source document", edge["strength"]["reasons"])
        # node document_count metadata reflects the linked document
        node = {n["id"]: n for n in result["nodes"]}[str(self.a.id)]
        self.assertEqual(node["metadata"]["document_count"], 1)

    def test_org_org_shared_doc_makes_edge(self):
        o1 = Organization.objects.create(case=self.case, name="Org One")
        o2 = Organization.objects.create(case=self.case, name="Org Two")
        d = _doc(self.case, "b")
        OrgDocument.objects.create(org=o1, document=d)
        OrgDocument.objects.create(org=o2, document=d)
        edges = build_case_map(self.case)["edges"]
        lo, hi, eid = pair_edge_id(o1.id, o2.id)
        self.assertIn(eid, {e["id"] for e in edges})


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


class PropertyTransactionTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.buyer = Organization.objects.create(case=self.case, name="Charity")
        self.seller = Person.objects.create(case=self.case, full_name="Insider")
        self.prop = Property.objects.create(case=self.case, address="123 Main St")

    def _tx(self, buyer_id, seller_id):
        return PropertyTransaction.objects.create(
            property=self.prop,
            buyer_id=buyer_id,
            buyer_type="ORGANIZATION",
            buyer_name="Charity",
            seller_id=seller_id,
            seller_type="PERSON",
            seller_name="Insider",
        )

    def test_two_sided_transaction_makes_subject_pair_edge(self):
        self._tx(self.buyer.id, self.seller.id)
        result = build_case_map(self.case)
        self.assertEqual(len(result["edges"]), 1)
        edge = result["edges"][0]
        lo, hi, eid = pair_edge_id(self.buyer.id, self.seller.id)
        self.assertEqual(edge["id"], eid)
        self.assertEqual(edge["strength"]["transaction_count"], 1)
        # single direct transaction (25 pts) lands in the documented band (20-49)
        self.assertEqual(edge["strength"]["level"], "documented")
        self.assertIn("transaction", edge["strength"]["categories"])
        self.assertEqual(edge["strength"]["relationship_types"], ["PURCHASED"])
        kinds = [u["source"] for u in edge["underlying_relationships"]]
        self.assertIn("property_transaction", kinds)

    def test_one_sided_transaction_makes_no_edge(self):
        # seller id does not resolve to any case subject
        self._tx(self.buyer.id, uuid.uuid4())
        result = build_case_map(self.case)
        self.assertEqual(result["edges"], [])


class ManualRelationshipTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.a = Person.objects.create(case=self.case, full_name="A")
        self.b = Person.objects.create(case=self.case, full_name="B")

    def test_manual_relationship_adds_family_evidence(self):
        Relationship.objects.create(
            case=self.case,
            person_a=self.a,
            person_b=self.b,
            relationship_type="SPOUSE",
        )
        result = build_case_map(self.case)
        self.assertEqual(len(result["edges"]), 1)
        s = result["edges"][0]["strength"]
        self.assertIn("family_or_personal", s["categories"])
        self.assertEqual(
            result["edges"][0]["underlying_relationships"][0]["source"],
            "manual_relationship",
        )


class ThreadAttachmentTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.insider = Person.objects.create(case=self.case, full_name="Insider")
        self.org = Organization.objects.create(case=self.case, name="Charity")

    def _link(self, finding, subject, etype):
        FindingEntity.objects.create(finding=finding, entity_id=subject.id, entity_type=etype)

    def test_thread_via_finding_entity_subject_links(self):
        # Simplest path: a Finding that DOES link both subjects directly.
        f = Finding.objects.create(
            case=self.case,
            rule_id="MANUAL",
            title="Manual thread",
            status=FindingStatus.NEEDS_EVIDENCE,
            severity="MEDIUM",
        )
        self._link(f, self.insider, "person")
        self._link(f, self.org, "organization")
        edge = build_case_map(self.case)["edges"][0]
        self.assertEqual(edge["thread_refs"][0]["thread_id"], str(f.id))
        node = {n["id"]: n for n in build_case_map(self.case)["nodes"]}[str(self.insider.id)]
        self.assertTrue(node["flags"]["has_active_thread"])

    def test_sr015_pair_inferred_from_evidence_buyer_seller(self):
        # SR-015's FindingEntity / trigger is the PROPERTY. The subject pair lives
        # in evidence_snapshot buyer_id/seller_id and must be inferred from there.
        prop = Property.objects.create(case=self.case, address="1 Main")
        tx = PropertyTransaction.objects.create(property=prop)
        f = Finding.objects.create(
            case=self.case,
            rule_id="SR-015",
            title="Insider swap",
            status=FindingStatus.NEEDS_EVIDENCE,
            severity="HIGH",
            trigger_entity_id=tx.property_id,
            evidence_snapshot={
                "buyer_id": str(self.org.id),
                "seller_id": str(self.insider.id),
            },
        )
        self._link(f, prop, "property")  # only the property is a FindingEntity
        result = build_case_map(self.case)
        edges = result["edges"]
        self.assertEqual(len(edges), 1)
        lo, hi, eid = pair_edge_id(self.org.id, self.insider.id)
        self.assertEqual(edges[0]["id"], eid)
        ref = edges[0]["thread_refs"][0]
        self.assertEqual(ref["rule_id"], "SR-015")
        # signal_type comes from the rule registry, not from evidence_snapshot
        self.assertEqual(ref["signal_type"], "INSIDER_SWAP")

    def test_sr025_pair_inferred_from_underlying_transaction(self):
        # SR-025 (contradiction mode) has NO trigger entity and references the
        # transaction only by id. The subject pair must be recovered by resolving
        # transaction_examples -> PropertyTransaction -> buyer/seller subjects.
        prop = Property.objects.create(case=self.case, address="2 Oak")
        tx = PropertyTransaction.objects.create(
            property=prop,
            buyer_id=self.org.id,
            buyer_type="ORGANIZATION",
            seller_id=self.insider.id,
            seller_type="PERSON",
        )
        Finding.objects.create(
            case=self.case,
            rule_id="SR-025",
            title="990 denies related party",
            status=FindingStatus.NEEDS_EVIDENCE,
            severity="CRITICAL",
            evidence_snapshot={
                "denial_doc_id": "doc-uuid",
                "transaction_examples": [{"transaction_id": str(tx.id)}],
            },
        )
        # No subject FindingEntity links at all (trigger is the 990 document).
        result = build_case_map(self.case)
        lo, hi, eid = pair_edge_id(self.org.id, self.insider.id)
        edge = {e["id"]: e for e in result["edges"]}[eid]
        rule_ids = [t["rule_id"] for t in edge["thread_refs"]]
        self.assertIn("SR-025", rule_ids)
        self.assertEqual(edge["thread_refs"][0]["signal_type"], "RELATED_PARTY_TX")

    def test_substantiated_thread_plus_evidence_reaches_material(self):
        # role (30) + 2 tx (50) = 80 raw -> capped repeated; +substantiated thread -> material
        PersonOrganization.objects.create(person=self.insider, org=self.org, role="Board")
        prop = Property.objects.create(case=self.case, address="1 Main")
        for _ in range(2):
            PropertyTransaction.objects.create(
                property=prop,
                buyer_id=self.org.id,
                buyer_type="ORGANIZATION",
                seller_id=self.insider.id,
                seller_type="PERSON",
            )
        f = Finding.objects.create(
            case=self.case,
            rule_id="SR-015",
            title="Insider swap",
            status=FindingStatus.CONFIRMED,
            severity="HIGH",
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
        )
        doc_q = _doc(self.case, "q")
        FindingDocument.objects.create(
            finding=f,
            document=doc_q,
        )
        # ASSERTION_V1 Tier-2: cited+handoff_ready assertion makes is_referral_grade True
        el = ThreadElement.objects.create(
            finding=f,
            element_type=ThreadElementType.ASSERTION,
            text="Insider payment of $500k.",
            position=0,
            handoff_ready=True,
        )
        ThreadElementCitation.objects.create(element=el, document=doc_q)
        self._link(f, self.insider, "person")
        self._link(f, self.org, "organization")
        result = build_case_map(self.case)
        edge = result["edges"][0]
        self.assertEqual(edge["strength"]["level"], "material")
        self.assertTrue(edge["strength"]["handoff_included"])
        self.assertEqual(edge["strength"]["substantiated_thread_count"], 1)
        # stats roll-ups reflect the material + handoff edge
        self.assertEqual(result["stats"]["material_edge_count"], 1)
        self.assertEqual(result["stats"]["handoff_edge_count"], 1)

    def test_dismissed_thread_is_ignored(self):
        f = Finding.objects.create(
            case=self.case,
            rule_id="SR-015",
            title="x",
            status=FindingStatus.DISMISSED,
        )
        self._link(f, self.insider, "person")
        self._link(f, self.org, "organization")
        # no other evidence -> no thread ref, and pair has no other evidence -> no edge
        self.assertEqual(build_case_map(self.case)["edges"], [])

    def test_dismissed_thread_excluded_but_independent_edge_survives(self):
        # An independent role edge exists between the same pair; the dismissed
        # thread must be excluded from thread_refs WITHOUT removing the edge.
        PersonOrganization.objects.create(person=self.insider, org=self.org, role="Board")
        f = Finding.objects.create(
            case=self.case, rule_id="SR-015", title="x", status=FindingStatus.DISMISSED
        )
        self._link(f, self.insider, "person")
        self._link(f, self.org, "organization")
        edges = build_case_map(self.case)["edges"]
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["thread_refs"], [])
        self.assertEqual(edges[0]["strength"]["level"], "documented")  # role only

    def test_confirmed_thread_sets_has_substantiated_thread_flag(self):
        f = Finding.objects.create(
            case=self.case, rule_id="MANUAL", title="t", status=FindingStatus.CONFIRMED
        )
        self._link(f, self.insider, "person")
        self._link(f, self.org, "organization")
        node = {n["id"]: n for n in build_case_map(self.case)["nodes"]}[str(self.insider.id)]
        self.assertTrue(node["flags"]["has_substantiated_thread"])

    def test_two_threads_on_one_pair_accumulate(self):
        for title in ("t1", "t2"):
            f = Finding.objects.create(
                case=self.case,
                rule_id="MANUAL",
                title=title,
                status=FindingStatus.NEEDS_EVIDENCE,
            )
            self._link(f, self.insider, "person")
            self._link(f, self.org, "organization")
        edge = build_case_map(self.case)["edges"][0]
        self.assertEqual(len(edge["thread_refs"]), 2)
        self.assertEqual(edge["strength"]["thread_count"], 2)
        node = {n["id"]: n for n in build_case_map(self.case)["nodes"]}[str(self.org.id)]
        self.assertEqual(node["metadata"]["thread_count"], 2)


class CaseMapEndpointContractTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.p = Person.objects.create(case=self.case, full_name="A")
        self.o = Organization.objects.create(case=self.case, name="B")
        PersonOrganization.objects.create(person=self.p, org=self.o, role="Board")

    def test_endpoint_returns_locked_contract(self):
        url = reverse("api_case_map", args=[self.case.id])
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        body = json.loads(resp.content)
        self.assertEqual(body["case_id"], str(self.case.id))
        # stats coherence: by_level sums to edge_count
        self.assertEqual(
            sum(body["stats"]["by_level"].values()),
            body["stats"]["edge_count"],
        )
        # every edge id is "{min}__{max}" with sorted endpoints
        for e in body["edges"]:
            self.assertEqual(e["id"], f"{e['source']}__{e['target']}")
            self.assertLess(e["source"], e["target"])
            for key in (
                "score",
                "level",
                "categories",
                "reasons",
                "substantiated_thread_count",
                "handoff_included",
            ):
                self.assertIn(key, e["strength"])
