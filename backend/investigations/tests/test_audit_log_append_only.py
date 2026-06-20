"""AuditLog is an append-only forensic record (CLAUDE.md: "NEVER UPDATE OR DELETE").

These tests enforce that invariant in code, not just in a docstring. They cover
both the per-object path (save/delete) AND the bulk queryset path
(objects.update/delete), because overriding only save()/delete() leaves the bulk
path wide open.
"""

from django.test import TestCase

from investigations.models import AppendOnlyError, AuditAction, AuditLog


class AuditLogAppendOnlyTests(TestCase):
    def _entry(self):
        return AuditLog.log(action=AuditAction.DOCUMENT_INGESTED, table_name="documents")

    def test_creating_an_entry_is_allowed(self):
        # Inserts must keep working — the guard only blocks mutation, not logging.
        entry = self._entry()
        self.assertIsNotNone(entry.pk)
        self.assertEqual(AuditLog.objects.count(), 1)

    def test_updating_an_existing_entry_raises(self):
        entry = self._entry()
        entry.notes = "tampered"
        with self.assertRaises(AppendOnlyError):
            entry.save()

    def test_deleting_an_entry_raises(self):
        entry = self._entry()
        with self.assertRaises(AppendOnlyError):
            entry.delete()

    def test_bulk_queryset_update_raises(self):
        self._entry()
        with self.assertRaises(AppendOnlyError):
            AuditLog.objects.all().update(notes="tampered")

    def test_bulk_queryset_delete_raises(self):
        self._entry()
        with self.assertRaises(AppendOnlyError):
            AuditLog.objects.all().delete()
