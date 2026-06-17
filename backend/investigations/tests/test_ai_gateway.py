from unittest.mock import MagicMock, patch

import anthropic
from django.test import SimpleTestCase

from investigations import ai_gateway


class AiGatewayTests(SimpleTestCase):
    def _response(self, text='{"ok": true}', input_tokens=12, output_tokens=5):
        response = MagicMock()
        response.content = [MagicMock(text=text)]
        response.usage.input_tokens = input_tokens
        response.usage.output_tokens = output_tokens
        return response

    @patch("investigations.ai_gateway._get_client")
    def test_call_json_returns_payload_and_usage(self, mock_get_client):
        client = MagicMock()
        client.messages.create.return_value = self._response()
        mock_get_client.return_value = client

        result = ai_gateway.call_json(
            system="system",
            user_message="user",
            model="claude-sonnet-4-6",
            temperature=0,
        )

        self.assertEqual(result.payload, {"ok": True})
        self.assertEqual(result.model, "claude-sonnet-4-6")
        self.assertEqual(result.input_tokens, 12)
        self.assertEqual(result.output_tokens, 5)
        self.assertIsNone(result.error)

    @patch("investigations.ai_gateway._get_client")
    def test_call_json_strips_markdown_fences(self, mock_get_client):
        client = MagicMock()
        client.messages.create.return_value = self._response('```json\n{"ok": true}\n```')
        mock_get_client.return_value = client

        result = ai_gateway.call_json(
            system="system",
            user_message="user",
            model="claude-sonnet-4-6",
            temperature=0,
        )

        self.assertEqual(result.payload, {"ok": True})

    @patch("investigations.ai_gateway._get_client")
    def test_call_json_returns_error_on_unparseable_json(self, mock_get_client):
        client = MagicMock()
        client.messages.create.return_value = self._response("not json")
        mock_get_client.return_value = client

        result = ai_gateway.call_json(
            system="system",
            user_message="user",
            model="claude-sonnet-4-6",
            temperature=0,
        )

        self.assertIsNone(result.payload)
        self.assertEqual(result.error, "AI returned non-JSON response")

    @patch("investigations.ai_gateway.time.sleep")
    @patch("investigations.ai_gateway._get_client")
    def test_retries_transient_errors(self, mock_get_client, mock_sleep):
        client = MagicMock()
        client.messages.create.side_effect = [
            anthropic.APIConnectionError(request=MagicMock()),
            self._response(),
        ]
        mock_get_client.return_value = client

        result = ai_gateway.call_json(
            system="system",
            user_message="user",
            model="claude-sonnet-4-6",
            temperature=0,
        )

        self.assertEqual(result.payload, {"ok": True})
        self.assertEqual(client.messages.create.call_count, 2)
