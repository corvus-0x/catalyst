"""CI unit test for the judge's parsing/flag mapping (Claude client mocked)."""

import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from investigations.tests.evals import lead_judge


def _lead(doc_refs=("Doc-1",), description="desc", narrative="why"):
    return SimpleNamespace(
        title="Pattern",
        description=description,
        narrative=narrative,
        evidence_snapshot={"doc_refs": list(doc_refs)},
    )


def _mock_client_returning(payload: dict):
    client = MagicMock()
    message = SimpleNamespace(content=[SimpleNamespace(text=json.dumps(payload))])
    client.messages.create.return_value = message
    return client


_CONTEXT = {
    "documents": [
        {"ref": "Doc-1", "doc_type": "IRS_990", "text_excerpt": "Gross receipts $1.2M..."}
    ],
    "entities": {"persons": [], "organizations": [], "properties": []},
    "financial_snapshots": [],
}


class JudgeSupportTests(TestCase):
    @patch("investigations.tests.evals.lead_judge.ai_proxy._get_client")
    def test_maps_results_to_per_lead_flags(self, mock_get_client):
        mock_get_client.return_value = _mock_client_returning(
            {"results": [{"index": 0, "supported": True}, {"index": 1, "supported": False}]}
        )
        flags = lead_judge.judge_support([_lead(), _lead()], _CONTEXT)
        self.assertEqual(flags, [True, False])

    def test_no_leads_returns_empty_without_calling_claude(self):
        # No patch needed: must short-circuit before any client call.
        self.assertEqual(lead_judge.judge_support([], _CONTEXT), [])

    @patch("investigations.tests.evals.lead_judge.ai_proxy._get_client")
    def test_incomplete_results_coverage_raises(self, mock_get_client):
        # Two leads but the judge only returns a verdict for index 0 -> must raise.
        mock_get_client.return_value = _mock_client_returning(
            {"results": [{"index": 0, "supported": True}]}
        )
        with self.assertRaises(lead_judge.JudgeError):
            lead_judge.judge_support([_lead(), _lead()], _CONTEXT)


class JudgeOverreachTests(TestCase):
    @patch("investigations.tests.evals.lead_judge.ai_proxy._get_client")
    def test_maps_results_to_per_lead_flags(self, mock_get_client):
        mock_get_client.return_value = _mock_client_returning(
            {"results": [{"index": 0, "overreaches": False}]}
        )
        flags = lead_judge.judge_overreach([_lead()], _CONTEXT)
        self.assertEqual(flags, [False])

    @patch("investigations.tests.evals.lead_judge.ai_proxy._get_client")
    def test_unparseable_response_raises(self, mock_get_client):
        client = MagicMock()
        client.messages.create.return_value = SimpleNamespace(
            content=[SimpleNamespace(text="not json")]
        )
        mock_get_client.return_value = client
        with self.assertRaises(lead_judge.JudgeError):
            lead_judge.judge_overreach([_lead()], _CONTEXT)

    @patch("investigations.tests.evals.lead_judge.ai_proxy._get_client")
    def test_strips_code_fences_before_parsing(self, mock_get_client):
        client = MagicMock()
        fenced = (
            "```json\n" + json.dumps({"results": [{"index": 0, "overreaches": True}]}) + "\n```"
        )
        client.messages.create.return_value = SimpleNamespace(
            content=[SimpleNamespace(text=fenced)]
        )
        mock_get_client.return_value = client
        self.assertEqual(lead_judge.judge_overreach([_lead()], _CONTEXT), [True])
