"""Tests for the four sync AI endpoints in views.py.

Covers `/ai/summarize/`, `/ai/connections/`, `/ai/narrative/`, `/ai/ask/`.

Each endpoint thinly wraps an `ai_proxy.ai_*()` helper. The helper does
the actual Claude call (mocked at the wrapper level here so we don't
exercise the SDK). These tests pin:
  - 200 happy paths return the JSON the helper produced
  - {"error": "..."} from the helper maps to non-200 status (500 generic,
    429 if the message contains "Rate limit")
  - Validation errors (400) for missing required body fields
  - 404 for nonexistent case
"""

import json
import uuid
from unittest.mock import patch

from django.test import Client, TestCase
from django.urls import reverse

from ..models import Case


class AiSummarizeEndpointTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="AI Summarize Case")
        self.url = reverse("api_ai_summarize", args=[self.case.pk])

    @patch("investigations.ai_proxy.ai_summarize")
    def test_happy_path_returns_helper_result(self, mock_helper):
        mock_helper.return_value = {
            "summary": "Insider transaction detected.",
            "key_facts": ["a", "b"],
            "risk_level": "high",
        }
        response = self.client.post(
            self.url,
            data=json.dumps({"target_type": "finding", "target_id": "x"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["risk_level"], "high")

    def test_missing_target_type_returns_400(self):
        response = self.client.post(
            self.url,
            data=json.dumps({"target_id": "x"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_missing_target_id_returns_400(self):
        response = self.client.post(
            self.url,
            data=json.dumps({"target_type": "finding"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_invalid_json_returns_400(self):
        response = self.client.post(self.url, data="not json", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    @patch("investigations.ai_proxy.ai_summarize")
    def test_helper_error_maps_to_500(self, mock_helper):
        mock_helper.return_value = {"error": "AI returned non-JSON response"}
        response = self.client.post(
            self.url,
            data=json.dumps({"target_type": "finding", "target_id": "x"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 500)

    @patch("investigations.ai_proxy.ai_summarize")
    def test_rate_limit_error_maps_to_429(self, mock_helper):
        mock_helper.return_value = {"error": "Rate limit exceeded. Try again."}
        response = self.client.post(
            self.url,
            data=json.dumps({"target_type": "finding", "target_id": "x"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 429)

    def test_404_for_unknown_case(self):
        response = self.client.post(
            reverse("api_ai_summarize", args=[uuid.uuid4()]),
            data=json.dumps({"target_type": "finding", "target_id": "x"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)


class AiConnectionsEndpointTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="AI Connections Case")
        self.url = reverse("api_ai_connections", args=[self.case.pk])

    @patch("investigations.ai_proxy.ai_connections")
    def test_happy_path(self, mock_helper):
        mock_helper.return_value = {
            "suggestions": [
                {
                    "from_entity": "A",
                    "to_entity": "B",
                    "relationship": "share address",
                    "reasoning": "Both at 123 Main",
                    "confidence": 0.8,
                }
            ],
            "patterns_detected": [],
        }
        response = self.client.post(self.url, data="{}", content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["suggestions"]), 1)

    def test_invalid_json_returns_400(self):
        response = self.client.post(self.url, data="not json", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    @patch("investigations.ai_proxy.ai_connections")
    def test_passes_entity_id_through(self, mock_helper):
        mock_helper.return_value = {"suggestions": []}
        self.client.post(
            self.url,
            data=json.dumps({"entity_id": "person-uuid-123"}),
            content_type="application/json",
        )
        # The helper was called with entity_id from the body.
        _, kwargs = mock_helper.call_args
        self.assertEqual(kwargs.get("entity_id"), "person-uuid-123")

    @patch("investigations.ai_proxy.ai_connections")
    def test_helper_error_maps_to_500(self, mock_helper):
        mock_helper.return_value = {"error": "boom"}
        response = self.client.post(self.url, data="{}", content_type="application/json")
        self.assertEqual(response.status_code, 500)


class AiNarrativeEndpointTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="AI Narrative Case")
        self.url = reverse("api_ai_narrative", args=[self.case.pk])

    @patch("investigations.ai_proxy.ai_narrative")
    def test_happy_path(self, mock_helper):
        mock_helper.return_value = {"narrative": "On 2023-06-01..."}
        response = self.client.post(
            self.url,
            data=json.dumps({"detection_ids": ["a", "b"]}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("2023-06-01", response.json()["narrative"])

    def test_empty_detection_ids_returns_400(self):
        response = self.client.post(
            self.url,
            data=json.dumps({"detection_ids": []}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_missing_detection_ids_returns_400(self):
        response = self.client.post(self.url, data="{}", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_invalid_tone_returns_400(self):
        response = self.client.post(
            self.url,
            data=json.dumps({"detection_ids": ["a"], "tone": "snarky"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    @patch("investigations.ai_proxy.ai_narrative")
    def test_valid_tones_pass_through(self, mock_helper):
        mock_helper.return_value = {"narrative": "..."}
        for tone in ("formal", "executive", "technical"):
            response = self.client.post(
                self.url,
                data=json.dumps({"detection_ids": ["a"], "tone": tone}),
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 200, msg=f"tone={tone}")


class AiAskEndpointTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="AI Ask Case")
        self.url = reverse("api_ai_ask", args=[self.case.pk])

    @patch("investigations.ai_proxy.ai_ask")
    def test_happy_path(self, mock_helper):
        mock_helper.return_value = {"answer": "Per the 990 ..."}
        response = self.client.post(
            self.url,
            data=json.dumps({"question": "Who is the president?"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("990", response.json()["answer"])

    def test_empty_question_returns_400(self):
        response = self.client.post(
            self.url,
            data=json.dumps({"question": ""}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_whitespace_only_question_returns_400(self):
        response = self.client.post(
            self.url,
            data=json.dumps({"question": "   "}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    @patch("investigations.ai_proxy.ai_ask")
    def test_passes_conversation_history(self, mock_helper):
        mock_helper.return_value = {"answer": "ok"}
        history = [
            {"role": "user", "content": "earlier turn"},
            {"role": "assistant", "content": "earlier reply"},
        ]
        self.client.post(
            self.url,
            data=json.dumps({"question": "follow-up", "conversation_history": history}),
            content_type="application/json",
        )
        # Helper receives both the question and the history.
        args, _ = mock_helper.call_args
        self.assertEqual(args[1], "follow-up")
        self.assertEqual(args[2], history)

    @patch("investigations.ai_proxy.ai_ask")
    def test_helper_error_maps_to_500(self, mock_helper):
        mock_helper.return_value = {"error": "model failure"}
        response = self.client.post(
            self.url,
            data=json.dumps({"question": "anything"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 500)
