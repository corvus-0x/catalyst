from django.test import TestCase

from investigations.models import Case, Document
from investigations.retrieval import search_case_documents


class RetrievalTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="Retrieval Case")
        self.other_case = Case.objects.create(name="Other Case")

    def _doc(self, case, filename, text):
        return Document.objects.create(
            case=case,
            filename=filename,
            file_path=f"cases/test/{filename}",
            sha256_hash=(filename.replace(".", "")[:1] or "x") * 64,
            file_size=1024,
            doc_type="DEED",
            extracted_text=text,
        )

    def test_returns_case_scoped_matches(self):
        self._doc(self.case, "match.pdf", "Sarah Mitchell signed the warranty deed.")
        self._doc(self.other_case, "other.pdf", "Sarah Mitchell appears elsewhere.")

        result = search_case_documents(self.case, "Sarah Mitchell")

        self.assertEqual(result["match_count"], 1)
        self.assertEqual(result["results"][0]["display_name"], "match.pdf")

    def test_ranks_more_term_hits_first(self):
        self._doc(self.case, "weak.pdf", "Sarah signed a document.")
        self._doc(self.case, "strong.pdf", "Sarah Mitchell signed. Mitchell appears again.")

        result = search_case_documents(self.case, "Sarah Mitchell")

        self.assertEqual(result["results"][0]["display_name"], "strong.pdf")

    def test_excludes_empty_ocr_text(self):
        self._doc(self.case, "empty.pdf", "")

        result = search_case_documents(self.case, "anything")

        self.assertEqual(result["match_count"], 0)
        self.assertEqual(result["results"], [])
