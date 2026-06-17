from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from investigations import ai_extraction
from investigations.ai_extraction import AIExtractionResult, AIProposal


class AiExtractionGatewayTests(SimpleTestCase):
    @patch("investigations.ai_extraction.ai_gateway.call_json")
    def test_call_claude_uses_gateway_result_and_usage(self, mock_call_json):
        mock_call_json.return_value = MagicMock(
            payload={"persons": [{"name": "Sarah Example"}]},
            error=None,
            model="claude-sonnet-4-6",
            input_tokens=20,
            output_tokens=7,
        )

        def parse_fn(data):
            return AIExtractionResult(
                proposals=[
                    AIProposal(
                        entity_type="person",
                        data=data["persons"][0],
                        confidence=0.9,
                        source_text="Sarah Example",
                    )
                ]
            )

        result = ai_extraction._call_claude("system", "user", parse_fn)

        self.assertIsNone(result.error)
        self.assertEqual(result.model_used, "claude-sonnet-4-6")
        self.assertEqual(result.input_tokens, 20)
        self.assertEqual(result.output_tokens, 7)
        self.assertEqual(result.proposals[0].data["name"], "Sarah Example")

    @patch("investigations.ai_extraction.ai_gateway.call_json")
    def test_call_claude_returns_extraction_error_from_gateway_error(self, mock_call_json):
        mock_call_json.return_value = MagicMock(
            payload=None,
            error="ANTHROPIC_API_KEY not set.",
            model="claude-sonnet-4-6",
            input_tokens=0,
            output_tokens=0,
        )

        result = ai_extraction._call_claude(
            "system",
            "user",
            lambda raw_text: AIExtractionResult(),
        )

        self.assertEqual(result.error, "ANTHROPIC_API_KEY not set.")
