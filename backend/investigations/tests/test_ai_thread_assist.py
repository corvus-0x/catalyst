"""Tests for ai_thread_assist (Phase 4D — assist-only proposals).

The hard constraint under test throughout: the assist pass NEVER creates
ThreadElement/ThreadElementCitation rows — proposals exist only in the
returned summary (persisted to SearchJob.result by the job runner).
"""

import json
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from investigations import ai_thread_assist
from investigations.models import (
    AuditAction,
    AuditLog,
    Case,
    Document,
    Finding,
    FindingDocument,
    JobStatus,
    JobType,
    SearchJob,
    ThreadElement,
    ThreadElementType,
)


def _doc(case, h, filename="d.pdf", text=""):
    return Document.objects.create(
        case=case,
        filename=filename,
        file_path=f"cases/t/{filename}",
        sha256_hash=h * 64,
        file_size=1024,
        extracted_text=text,
    )


def _finding(case, **kwargs):
    return Finding.objects.create(
        case=case,
        rule_id="",
        title=kwargs.pop("title", "Land transfers cluster"),
        description=kwargs.pop("description", "desc"),
        narrative=kwargs.pop("narrative", ""),
        severity="INFORMATIONAL",
        status="NEW",
        **kwargs,
    )


class BuildThreadContextTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.finding = _finding(self.case, narrative="freeform narrative text")

    def test_includes_thread_material_split_by_element_type(self):
        ThreadElement.objects.create(
            finding=self.finding,
            element_type=ThreadElementType.NOTE,
            text="a context note",
            position=0,
        )
        ThreadElement.objects.create(
            finding=self.finding,
            element_type=ThreadElementType.QUESTION,
            text="who signed the deed?",
            position=1,
        )
        ThreadElement.objects.create(
            finding=self.finding,
            element_type=ThreadElementType.ASSERTION,
            text="an existing assertion",
            position=2,
        )
        ctx, _ = ai_thread_assist.build_thread_context(self.finding)
        self.assertEqual(ctx["thread"]["narrative"], "freeform narrative text")
        self.assertEqual(ctx["thread"]["notes"], ["a context note"])
        self.assertEqual(ctx["thread"]["open_questions"], ["who signed the deed?"])
        self.assertEqual(ctx["thread"]["existing_assertions"], ["an existing assertion"])

    def test_linked_documents_come_first_in_doc_refs(self):
        _doc(self.case, "a", filename="unlinked-newest.pdf")
        linked = _doc(self.case, "b", filename="linked.pdf")
        FindingDocument.objects.create(finding=self.finding, document=linked)
        ctx, ref_map = ai_thread_assist.build_thread_context(self.finding)
        self.assertEqual(ctx["documents"][0]["filename"], "linked.pdf")
        self.assertEqual(ref_map["Doc-1"], str(linked.id))

    def test_context_respects_size_budget(self):
        for i in range(5):
            _doc(self.case, str(i), filename=f"big{i}.pdf", text="x" * 2000)
        with patch.object(ai_thread_assist, "MAX_CONTEXT_CHARS", 5000):
            ctx, ref_map = ai_thread_assist.build_thread_context(self.finding)
        self.assertLess(len(json.dumps(ctx)), 5000)
        # dropped docs must be gone from the ref map (no dangling citations)
        self.assertEqual(len(ref_map), len(ctx["documents"]))


class ValidateProposalsTests(TestCase):
    def test_keeps_wellformed_and_strips_unknown_refs(self):
        kept, dropped = ai_thread_assist.validate_proposals(
            [
                {
                    "text": "The deed was recorded in March.",
                    "doc_refs": ["Doc-1", "Doc-9"],
                    "basis": "from note",
                }
            ],
            {"Doc-1": "uuid-1"},
        )
        self.assertEqual(dropped, 0)
        self.assertEqual(kept[0]["doc_refs"], ["Doc-1"])  # Doc-9 stripped, kept

    def test_uncited_proposal_is_kept(self):
        kept, dropped = ai_thread_assist.validate_proposals(
            [{"text": "Pattern suggests a shared signer.", "doc_refs": [], "basis": ""}],
            {},
        )
        self.assertEqual(len(kept), 1)
        self.assertEqual(dropped, 0)

    def test_drops_empty_text_and_forbidden_terms(self):
        kept, dropped = ai_thread_assist.validate_proposals(
            [
                {"text": "", "doc_refs": []},
                {"text": "This proves criminal fraud.", "doc_refs": []},
                {"text": "fine", "doc_refs": []},
            ],
            {},
        )
        self.assertEqual(len(kept), 1)
        self.assertEqual(dropped, 2)

    def test_caps_proposal_count(self):
        many = [{"text": f"assertion {i}", "doc_refs": []} for i in range(20)]
        kept, _ = ai_thread_assist.validate_proposals(many, {})
        self.assertEqual(len(kept), ai_thread_assist.MAX_PROPOSALS)


class ProposeAssertionsTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.finding = _finding(self.case, narrative="notes to structure")
        self.doc = _doc(self.case, "a", filename="deed.pdf", text="deed text")

    def _mock_payload(self, proposals):
        return json.dumps({"proposals": proposals})

    @patch("investigations.ai_thread_assist.call_claude")
    def test_returns_proposals_and_creates_no_elements(self, mock_call):
        mock_call.return_value = self._mock_payload(
            [{"text": "The deed names the insider.", "doc_refs": ["Doc-1"], "basis": "n"}]
        )
        summary = ai_thread_assist.propose_assertions(self.finding.id)
        self.assertEqual(len(summary["proposals"]), 1)
        p = summary["proposals"][0]
        self.assertEqual(p["documents"][0]["document_id"], str(self.doc.id))
        self.assertEqual(p["documents"][0]["filename"], "deed.pdf")
        # THE 4D constraint: nothing persisted by the AI pass
        self.assertEqual(ThreadElement.objects.count(), 0)

    @patch("investigations.ai_thread_assist.call_claude")
    def test_writes_run_audit_entry(self, mock_call):
        mock_call.return_value = self._mock_payload([])
        ai_thread_assist.propose_assertions(self.finding.id)
        entry = AuditLog.objects.filter(action=AuditAction.AI_THREAD_ASSIST_COMPLETED).latest(
            "performed_at"
        )
        self.assertEqual(entry.after_state["finding_id"], str(self.finding.id))
        self.assertEqual(entry.after_state["proposals_returned"], 0)

    @patch("investigations.ai_thread_assist.call_claude")
    def test_malformed_response_yields_empty_proposals(self, mock_call):
        mock_call.return_value = "not json"
        summary = ai_thread_assist.propose_assertions(self.finding.id)
        self.assertEqual(summary["proposals"], [])


class ThreadAssistEndpointTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.finding = _finding(self.case)
        self.url = reverse("api_thread_assist", args=[self.case.id, self.finding.id])

    def test_returns_202_with_job_id(self):
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 202)
        body = json.loads(resp.content)
        self.assertIn("job_id", body)
        job = SearchJob.objects.get(pk=body["job_id"])
        self.assertEqual(job.job_type, JobType.AI_THREAD_ASSIST)
        self.assertEqual(job.query_params["finding_id"], str(self.finding.id))

    def test_409_when_assist_already_in_flight_for_finding(self):
        SearchJob.objects.create(
            case=self.case,
            job_type=JobType.AI_THREAD_ASSIST,
            status=JobStatus.RUNNING,
            query_params={"case_id": str(self.case.id), "finding_id": str(self.finding.id)},
        )
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 409)

    def test_other_findings_assist_does_not_block(self):
        other = _finding(self.case, title="other thread")
        SearchJob.objects.create(
            case=self.case,
            job_type=JobType.AI_THREAD_ASSIST,
            status=JobStatus.RUNNING,
            query_params={"case_id": str(self.case.id), "finding_id": str(other.id)},
        )
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 202)

    def test_404_for_finding_outside_case(self):
        other_case = Case.objects.create(name="D")
        url = reverse("api_thread_assist", args=[other_case.id, self.finding.id])
        resp = self.client.post(url)
        self.assertEqual(resp.status_code, 404)


class RunThreadAssistJobTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.finding = _finding(self.case)
        self.job = SearchJob.objects.create(
            case=self.case,
            job_type=JobType.AI_THREAD_ASSIST,
            query_params={"case_id": str(self.case.id), "finding_id": str(self.finding.id)},
        )

    @patch("investigations.ai_thread_assist.call_claude")
    def test_marks_success_with_proposals_in_result(self, mock_call):
        from investigations.jobs import run_thread_assist

        mock_call.return_value = json.dumps(
            {"proposals": [{"text": "one checkable statement", "doc_refs": [], "basis": "b"}]}
        )
        run_thread_assist(str(self.job.id))
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, JobStatus.SUCCESS)
        self.assertEqual(len(self.job.result["proposals"]), 1)

    @patch("investigations.ai_thread_assist.call_claude")
    def test_marks_failed_on_ai_error(self, mock_call):
        from investigations.jobs import run_thread_assist

        mock_call.side_effect = ai_thread_assist.AIThreadAssistError("API down")
        run_thread_assist(str(self.job.id))
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, JobStatus.FAILED)
        self.assertNotIn("API down", self.job.error_message)
        self.assertIn("could not be completed", self.job.error_message)
