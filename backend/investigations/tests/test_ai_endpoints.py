"""Tests for the AI endpoints in views.py.

Covers `/ai/ask/`.

`/ai/ask/` is asynchronous: it enqueues a SearchJob and returns 202 with
a job_id. The actual Claude call happens in the background worker. Tests
pin:
  - 202 with job_id on valid request
  - 400 for missing/empty question
  - Conversation history is stored in cache (not query_params) and
    job query_params carry the history_ref + question
"""

import json

from django.core.cache import cache
from django.test import Client, TestCase
from django.urls import reverse

from ..models import Case, SearchJob


class AiAskEndpointTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="AI Ask Case")
        self.url = reverse("api_ai_ask", args=[self.case.pk])

    def test_happy_path(self):
        # /ai/ask/ is async: enqueues a SearchJob and returns 202 with job_id.
        # The actual Claude call happens in the background worker.
        response = self.client.post(
            self.url,
            data=json.dumps({"question": "Who is the president?"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 202)
        body = response.json()
        self.assertIn("job_id", body)
        self.assertIn("status_url", body)

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

    def test_passes_conversation_history(self):
        # The async view stores history in the cache (keyed by history_ref)
        # and puts only the history_ref + question into SearchJob.query_params.
        history = [
            {"role": "user", "content": "earlier turn"},
            {"role": "assistant", "content": "earlier reply"},
        ]
        response = self.client.post(
            self.url,
            data=json.dumps({"question": "follow-up", "conversation_history": history}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 202)
        job_id = response.json()["job_id"]
        job = SearchJob.objects.get(pk=job_id)
        self.assertEqual(job.query_params["question"], "follow-up")
        history_ref = job.query_params["history_ref"]
        cached = cache.get(f"ai_ask_history:{history_ref}")
        self.assertEqual(cached, history)

    def test_view_always_returns_202_not_500(self):
        # Error handling for the ai_ask helper moved to the async job runner.
        # The view itself no longer calls ai_ask() synchronously, so it can
        # never return 500 at the view layer — it always enqueues and returns 202.
        response = self.client.post(
            self.url,
            data=json.dumps({"question": "anything"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 202)
