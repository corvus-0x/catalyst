"""Importable forward logic for the Phase 4 backfill data migration.

Unit-testable without a migration replay. Idempotent + collision-safe. Uses a
FROZEN inline copy of the OLD referral-grade predicate so it stays correct after
4B rewrites referral_grade.py.
"""

from django.db.models import Max

# Frozen copy of the OLD referral-grade weights (do not import from referral_grade.py).
_OLD_REFERRAL_WEIGHTS = {"DOCUMENTED", "TRACED"}


def _was_referral_grade_old(finding, FindingDocument) -> bool:
    return (
        finding.status == "CONFIRMED"
        and finding.evidence_weight in _OLD_REFERRAL_WEIGHTS
        and finding.overreach_reviewed
        and FindingDocument.objects.filter(finding=finding).exists()
    )


def forwards(apps, schema_editor):
    Finding = apps.get_model("investigations", "Finding")
    ThreadElement = apps.get_model("investigations", "ThreadElement")
    FindingDocument = apps.get_model("investigations", "FindingDocument")

    # 1) Flag all existing citations legacy (preserved, never reaped).
    FindingDocument.objects.update(is_legacy=True)

    for finding in Finding.objects.all():
        # 2) Grandfather: old-referral-grade -> LEGACY_NARRATIVE (others keep ASSERTION_V1 default).
        if _was_referral_grade_old(finding, FindingDocument):
            if finding.gate_version != "LEGACY_NARRATIVE":
                finding.gate_version = "LEGACY_NARRATIVE"
                finding.save(update_fields=["gate_version"])

        # 3) narrative -> NOTE (idempotent; next free position; narrative retained).
        if (finding.narrative or "").strip():
            exists = ThreadElement.objects.filter(
                finding=finding, element_type="NOTE", text=finding.narrative
            ).exists()
            if not exists:
                max_pos = ThreadElement.objects.filter(finding=finding).aggregate(
                    m=Max("position")
                )["m"]
                next_pos = 0 if max_pos is None else max_pos + 1
                ThreadElement.objects.create(
                    finding=finding,
                    element_type="NOTE",
                    text=finding.narrative,
                    position=next_pos,
                    handoff_ready=False,
                )


def backwards(apps, schema_editor):
    pass  # non-reversible data migration; NOTE elements are harmless to keep
