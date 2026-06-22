from django.test import TestCase

from investigations.models import Case, Document, Finding, FindingDocument, FindingStatus
from investigations.serializers import FindingUpdateSerializer


class AddDocumentIdsLegacyTests(TestCase):
    def test_add_document_ids_creates_legacy_rows(self):
        case = Case.objects.create(name="C")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T", status=FindingStatus.NEW)
        doc = Document.objects.create(
            case=case, filename="d.pdf", file_path="d.pdf", sha256_hash="d" * 64, file_size=1
        )
        s = FindingUpdateSerializer(data={"add_document_ids": [str(doc.id)]}, instance=f)
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        self.assertTrue(FindingDocument.objects.get(finding=f, document=doc).is_legacy)
