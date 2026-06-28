"""Unit tests for the referral-PDF section mapper (Phase 4C).

The mapper decides ONE thing: which evidentiary section a ThreadElement belongs
to in the referral PDF. It is deterministic, takes the citation predicate as an
injected argument, and touches neither the database nor reportlab — so these
tests run as SimpleTestCase with lightweight fake elements. (SimpleTestCase
forbids DB access, which pins the "no ORM in the mapper" boundary.)
"""

from types import SimpleNamespace

from django.test import SimpleTestCase

from ..models import ThreadElementType
from ..referral_export import (
    ReferralSection,
    _pdf_escape,
    _strip_legacy_doc_tokens,
    map_thread_element_to_referral_section,
)


def _element(element_type, handoff_ready=False):
    """A DB-free stand-in for a ThreadElement (only the fields the mapper reads)."""
    return SimpleNamespace(element_type=element_type, handoff_ready=handoff_ready)


def _cited(_element):
    return True


def _uncited(_element):
    return False


def _explode(_element):  # pragma: no cover - only fires on a precedence bug
    raise AssertionError("is_cited must not be consulted for a handoff_ready assertion")


class MapThreadElementToReferralSectionTests(SimpleTestCase):
    # --- ASSERTION: the full cited/uncited × handoff/not truth table ---

    def test_cited_non_handoff_assertion_is_documented_fact(self):
        section = map_thread_element_to_referral_section(
            _element(ThreadElementType.ASSERTION, handoff_ready=False), is_cited=_cited
        )
        self.assertEqual(section, ReferralSection.DOCUMENTED_FACTS)

    def test_uncited_non_handoff_assertion_is_analysis(self):
        section = map_thread_element_to_referral_section(
            _element(ThreadElementType.ASSERTION, handoff_ready=False), is_cited=_uncited
        )
        self.assertEqual(section, ReferralSection.ANALYSIS)

    def test_cited_handoff_assertion_is_referral_assertion(self):
        section = map_thread_element_to_referral_section(
            _element(ThreadElementType.ASSERTION, handoff_ready=True), is_cited=_cited
        )
        self.assertEqual(section, ReferralSection.REFERRAL_ASSERTIONS)

    def test_uncited_handoff_assertion_is_referral_assertion(self):
        section = map_thread_element_to_referral_section(
            _element(ThreadElementType.ASSERTION, handoff_ready=True), is_cited=_uncited
        )
        self.assertEqual(section, ReferralSection.REFERRAL_ASSERTIONS)

    def test_handoff_precedence_does_not_consult_citation(self):
        # handoff_ready dominates: the bucket decision must not depend on is_cited.
        section = map_thread_element_to_referral_section(
            _element(ThreadElementType.ASSERTION, handoff_ready=True), is_cited=_explode
        )
        self.assertEqual(section, ReferralSection.REFERRAL_ASSERTIONS)

    # --- QUESTION / NOTE ---

    def test_question_is_open_questions(self):
        section = map_thread_element_to_referral_section(
            _element(ThreadElementType.QUESTION), is_cited=_explode
        )
        self.assertEqual(section, ReferralSection.OPEN_QUESTIONS)

    def test_note_is_omitted(self):
        section = map_thread_element_to_referral_section(
            _element(ThreadElementType.NOTE), is_cited=_explode
        )
        self.assertEqual(section, ReferralSection.OMIT)

    # --- defensive totality: an unknown element_type maps somewhere, never raises ---

    def test_unknown_element_type_is_omitted(self):
        section = map_thread_element_to_referral_section(_element("WILDCARD"), is_cited=_explode)
        self.assertEqual(section, ReferralSection.OMIT)

    # --- default predicate is the gate's assertion_is_cited (parity by construction) ---

    def test_default_predicate_is_assertion_is_cited(self):
        from ..referral_export import assertion_is_cited as exported
        from ..thread_elements import assertion_is_cited

        self.assertIs(exported, assertion_is_cited)


class StripLegacyDocTokensTests(SimpleTestCase):
    """_strip_legacy_doc_tokens removes ONLY bracketed legacy citation tokens
    (\[Doc-\d+\]) so the ASSERTION_V1 "no [Doc-" promise holds even if an
    investigator typed one into their assertion text. It must not touch other
    bracketed content."""

    def test_strips_a_doc_token(self):
        self.assertEqual(
            _strip_legacy_doc_tokens("Paid $5,000 [Doc-3] to the vendor."),
            "Paid $5,000 to the vendor.",
        )

    def test_strips_multiple_doc_tokens(self):
        self.assertEqual(
            _strip_legacy_doc_tokens("See [Doc-1] and [Doc-22] for proof."),
            "See and for proof.",
        )

    def test_leaves_non_doc_brackets_untouched(self):
        self.assertEqual(
            _strip_legacy_doc_tokens("Filed [Schedule L] per [IRC 4958]."),
            "Filed [Schedule L] per [IRC 4958].",
        )

    def test_leaves_doc_token_without_digits_untouched(self):
        # Not a legacy citation token — no numeric id.
        self.assertEqual(_strip_legacy_doc_tokens("[Doc-]"), "[Doc-]")

    def test_collapses_whitespace_left_by_removal(self):
        self.assertEqual(_strip_legacy_doc_tokens("a  [Doc-3]  b"), "a b")

    def test_handles_empty_string(self):
        self.assertEqual(_strip_legacy_doc_tokens(""), "")


class PdfEscapeTests(SimpleTestCase):
    """_pdf_escape escapes ONLY the characters reportlab's mini-HTML parser would
    misinterpret in user-controlled text. It is applied to interpolated data, never
    to intentional markup labels like <b>Documented</b>."""

    def test_escapes_ampersand(self):
        self.assertEqual(_pdf_escape("Smith & Jones"), "Smith &amp; Jones")

    def test_escapes_angle_brackets(self):
        self.assertEqual(_pdf_escape("a < b > c"), "a &lt; b &gt; c")

    def test_escapes_markup_like_text_so_it_renders_literally(self):
        self.assertEqual(
            _pdf_escape("<b>not bold</b>"),
            "&lt;b&gt;not bold&lt;/b&gt;",
        )

    def test_ampersand_escaped_once(self):
        # & must become &amp; — not double-escaped into &amp;lt; etc.
        self.assertEqual(_pdf_escape("a < b & c"), "a &lt; b &amp; c")

    def test_none_becomes_empty_string(self):
        self.assertEqual(_pdf_escape(None), "")

    def test_plain_text_unchanged(self):
        self.assertEqual(_pdf_escape("Board of Directors"), "Board of Directors")
