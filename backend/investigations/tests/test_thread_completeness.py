from django.test import TestCase

from investigations.models import Case, Document, Finding, ThreadElement, ThreadElementType
from investigations.thread_elements import (
    assertion_is_cited,
    finding_has_cited_assertion,
    finding_has_handoff_ready_assertion,
)


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class CompletenessTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.f = Finding.objects.create(case=self.case, rule_id="MANUAL", title="T")

    def _assertion(self, pos, cited=True, text="a", handoff=False):
        el = ThreadElement.objects.create(
            finding=self.f,
            element_type=ThreadElementType.ASSERTION,
            position=pos,
            text=text,
            handoff_ready=handoff,
        )
        if cited:
            el.citations.create(document=_doc(self.case, str(pos)))
        return el

    def test_assertion_is_cited(self):
        self.assertTrue(assertion_is_cited(self._assertion(0)))
        self.assertFalse(assertion_is_cited(self._assertion(1, cited=False)))
        self.assertFalse(assertion_is_cited(self._assertion(2, cited=True, text="")))

    def test_question_never_cited(self):
        q = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.QUESTION, position=0, text="q?"
        )
        self.assertFalse(assertion_is_cited(q))

    def test_finding_helpers(self):
        self.assertFalse(finding_has_cited_assertion(self.f))
        self.assertFalse(finding_has_handoff_ready_assertion(self.f))
        self._assertion(0)  # cited
        self._assertion(1, cited=False, handoff=True)  # handoff_ready (uncited)
        self.assertTrue(finding_has_cited_assertion(self.f))
        self.assertTrue(finding_has_handoff_ready_assertion(self.f))
