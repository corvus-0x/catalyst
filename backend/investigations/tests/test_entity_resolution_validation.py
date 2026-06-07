"""Tests for data_quality validators wired into entity resolution.

Before the QA audit P1 fix, validate_ein / validate_person / validate_property
were never called from the resolution path — extracted entities were created
without any sanity check. These tests verify the validators are invoked and
their output is at least logged.
"""

from unittest.mock import patch

from django.test import TestCase

from .. import entity_resolution
from ..models import Case


class ResolveEntitiesValidatorWiredTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="Validator Wiring Case")

    @patch("investigations.data_quality.validate_person")
    def test_resolve_person_calls_validate_person(self, mock_validate):
        mock_validate.return_value = entity_resolution.__class__  # placeholder
        # Need a real ValidationResult; import lazily to avoid the placeholder.
        from .. import data_quality

        mock_validate.return_value = data_quality.ValidationResult()

        entity_resolution.resolve_person("Sarah Example", self.case)

        mock_validate.assert_called_once()
        called_with = mock_validate.call_args[0][0]
        self.assertEqual(called_with["full_name"], "Sarah Example")

    @patch("investigations.data_quality.validate_ein")
    def test_resolve_org_calls_validate_ein_when_ein_supplied(self, mock_validate):
        from .. import data_quality

        mock_validate.return_value = data_quality.ValidationResult()

        entity_resolution.resolve_org("Bright Future Foundation", self.case, ein="12-3456789")

        mock_validate.assert_called_once_with("12-3456789")

    @patch("investigations.data_quality.validate_ein")
    def test_resolve_org_skips_validate_ein_when_no_ein(self, mock_validate):
        entity_resolution.resolve_org("No EIN Org", self.case)
        mock_validate.assert_not_called()

    @patch("investigations.data_quality.validate_ein")
    def test_resolve_org_uses_normalized_ein_from_validator(self, mock_validate):
        """Validator returns the canonical XX-XXXXXXX form; org should adopt it."""
        from .. import data_quality
        from ..models import Organization

        result = data_quality.ValidationResult()
        result.corrected_data["ein"] = "12-3456789"
        mock_validate.return_value = result

        # Pass a dashless EIN to confirm the validator's normalization wins.
        entity_resolution.resolve_org("Some Org", self.case, ein="123456789")

        org = Organization.objects.get(case=self.case, name="Some Org")
        self.assertEqual(org.ein, "12-3456789")
