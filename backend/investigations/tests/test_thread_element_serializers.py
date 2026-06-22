from django.test import TestCase

from investigations.models import Case, Document, Finding, ThreadElement, ThreadElementType
from investigations.serializers import (
    ThreadElementCitationSerializer,
    ThreadElementCreateSerializer,
    ThreadElementUpdateSerializer,
    serialize_element,
)


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class ElementSerializerTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.f = Finding.objects.create(case=self.case, rule_id="MANUAL", title="T")

    def _assertion(self, pos=0, cited=False, handoff=False):
        el = ThreadElement.objects.create(
            finding=self.f,
            element_type=ThreadElementType.ASSERTION,
            position=pos,
            text="x",
            handoff_ready=handoff,
        )
        if cited:
            el.citations.create(document=_doc(self.case, str(pos)))
        return el

    def test_create_assigns_next_position(self):
        ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.ASSERTION, position=0
        )
        s = ThreadElementCreateSerializer(
            data={"element_type": "QUESTION", "text": "q"}, finding=self.f
        )
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.save().position, 1)

    def test_create_rejects_bad_type(self):
        s = ThreadElementCreateSerializer(data={"element_type": "FACT"}, finding=self.f)
        self.assertFalse(s.is_valid())
        self.assertIn("element_type", s.errors)

    def test_update_rejects_empty_payload(self):
        a = self._assertion()
        s = ThreadElementUpdateSerializer(data={}, instance=a)
        self.assertFalse(s.is_valid())
        self.assertIn("non_field_errors", s.errors)

    def test_handoff_ready_rejected_on_non_assertion(self):
        q = ThreadElement.objects.create(
            finding=self.f,
            element_type=ThreadElementType.QUESTION,
            position=0,
            text="q",
        )
        s = ThreadElementUpdateSerializer(data={"handoff_ready": True}, instance=q)
        self.assertFalse(s.is_valid())
        self.assertIn("handoff_ready", s.errors)

    def test_handoff_ready_allowed_on_assertion_with_text(self):
        a = self._assertion()
        s = ThreadElementUpdateSerializer(data={"handoff_ready": True}, instance=a)
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        a.refresh_from_db()
        self.assertTrue(a.handoff_ready)

    def test_type_change_off_assertion_blocked_while_cited(self):
        a = self._assertion(cited=True)
        s = ThreadElementUpdateSerializer(data={"element_type": "NOTE"}, instance=a)
        self.assertFalse(s.is_valid())
        self.assertIn("element_type", s.errors)

    def test_citation_rejected_on_non_assertion(self):
        q = ThreadElement.objects.create(
            finding=self.f,
            element_type=ThreadElementType.QUESTION,
            position=0,
            text="q",
        )
        s = ThreadElementCitationSerializer(
            data={"document_id": str(_doc(self.case).id)}, element=q
        )
        self.assertFalse(s.is_valid())
        self.assertIn("element", s.errors)

    def test_citation_same_case_enforced(self):
        a = self._assertion()
        other = _doc(Case.objects.create(name="O"), "z")
        s = ThreadElementCitationSerializer(data={"document_id": str(other.id)}, element=a)
        self.assertFalse(s.is_valid())
        self.assertIn("document_id", s.errors)

    def test_serialize_role_derivation(self):
        self.assertEqual(serialize_element(self._assertion(0))["role"], "analysis")
        self.assertEqual(serialize_element(self._assertion(1, cited=True))["role"], "fact")
        self.assertEqual(serialize_element(self._assertion(2, handoff=True))["role"], "claim")
        q = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.QUESTION, position=3, text="q"
        )
        self.assertEqual(serialize_element(q)["role"], "question")
