from django.apps import apps
from django.test import TestCase

from investigations.models import (
    Case,
    Document,
    EvidenceWeight,
    Finding,
    FindingDocument,
    FindingStatus,
    GateVersion,
    ThreadElement,
    ThreadElementType,
)


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class NarrativeMigrationTests(TestCase):
    def test_forwards_converts_narrative_flags_docs_retains_narrative(self):
        from investigations.migrations import _phase4_narrative_backfill as mig

        case = Case.objects.create(name="C")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T", narrative="legacy text")
        FindingDocument.objects.create(finding=f, document=_doc(case))

        mig.forwards(apps, schema_editor=None)

        note = f.elements.get(element_type=ThreadElementType.NOTE)
        self.assertEqual(note.text, "legacy text")
        self.assertEqual(f.narrative, "legacy text")  # retained
        self.assertTrue(FindingDocument.objects.filter(finding=f, is_legacy=True).exists())

    def test_idempotent_and_collision_safe(self):
        from investigations.migrations import _phase4_narrative_backfill as mig

        case = Case.objects.create(name="C2")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T", narrative="n")
        ThreadElement.objects.create(
            finding=f, element_type=ThreadElementType.ASSERTION, position=0, text="x"
        )

        mig.forwards(apps, schema_editor=None)
        mig.forwards(apps, schema_editor=None)

        notes = f.elements.filter(element_type=ThreadElementType.NOTE)
        self.assertEqual(notes.count(), 1)
        self.assertNotEqual(notes.first().position, 0)

    def test_grandfathers_old_referral_grade_to_legacy(self):
        from investigations.migrations import _phase4_narrative_backfill as mig

        case = Case.objects.create(name="C3")
        # referral-grade under the OLD predicate: CONFIRMED + DOCUMENTED + overreach + a doc
        grade = Finding.objects.create(
            case=case,
            rule_id="MANUAL",
            title="grade",
            narrative="n",
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
        )
        FindingDocument.objects.create(finding=grade, document=_doc(case, "g"))
        # not referral-grade (NEW)
        plain = Finding.objects.create(case=case, rule_id="MANUAL", title="plain", narrative="n")

        mig.forwards(apps, schema_editor=None)
        grade.refresh_from_db()
        plain.refresh_from_db()
        self.assertEqual(grade.gate_version, GateVersion.LEGACY_NARRATIVE)
        self.assertEqual(plain.gate_version, GateVersion.ASSERTION_V1)
