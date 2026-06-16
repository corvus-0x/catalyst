"""Live-Claude eval: faithfulness + overreach of AI Leads over golden fixtures.

Gated behind @tag("eval") — excluded from CI. Run explicitly with a real key:

    python manage.py test investigations.tests.evals.test_lead_quality --tag=eval

Needs ANTHROPIC_API_KEY. Writes results/lead_eval.json (gitignored).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from django.test import TestCase, tag

from investigations.ai_pattern_augmentation import analyze_case, build_context_with_refs
from investigations.models import Finding, FindingSource
from investigations.tests.evals import lead_judge, lead_scorers
from investigations.tests.evals.lead_fixtures import GOLDEN_CASES
from investigations.tests.evals.lead_seeder import seed_case

_RESULTS_DIR = Path(__file__).parent / "results"


@tag("eval")
class LeadQualityEval(TestCase):
    """One real generation + two judge calls per fixture."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.scorecard: list[dict] = []

    @classmethod
    def tearDownClass(cls):
        _RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        (_RESULTS_DIR / "lead_eval.json").write_text(
            json.dumps(getattr(cls, "scorecard", []), indent=2)
        )
        super().tearDownClass()

    def test_fixtures(self):
        self.assertTrue(os.environ.get("ANTHROPIC_API_KEY"), "ANTHROPIC_API_KEY required")

        for fixture in GOLDEN_CASES:
            with self.subTest(fixture=fixture["id"]):
                case = seed_case(fixture)
                analyze_case(case.id)  # real Claude; persists Finding rows
                leads = list(Finding.objects.filter(case=case, source=FindingSource.AI))
                context, _, _ = build_context_with_refs(case)
                valid_doc_ids = {str(d.id) for d in case.documents.all()}

                cited_ok = lead_scorers.citation_integrity(leads, valid_doc_ids)
                terms_ok = lead_scorers.forbidden_terms_clean(leads)

                # Judge calls can raise JudgeError; capture so one bad fixture
                # neither aborts the loop nor truncates the results artifact.
                judge_error = None
                faith, faith_flags, orr, over_flags = 1.0, [], 0.0, []
                try:
                    support = lead_judge.judge_support(leads, context)
                    over = lead_judge.judge_overreach(leads, context)
                    faith, faith_flags = lead_scorers.faithfulness(leads, support)
                    orr, over_flags = lead_scorers.overreach(leads, over)
                except lead_judge.JudgeError as exc:
                    judge_error = str(exc)

                # Record BEFORE any assertion so the JSON artifact stays complete
                # even when a fixture fails its gate or the judge errors.
                type(self).scorecard.append(
                    {
                        "fixture": fixture["id"],
                        "n_leads": len(leads),
                        "faithfulness": faith,
                        "overreach": orr,
                        "citation_integrity": cited_ok,
                        "forbidden_terms_clean": terms_ok,
                        "judge_error": judge_error,
                    }
                )
                self._print_scorecard(fixture, leads, faith_flags, over_flags, faith, orr)

                # --- Gates: failures are recorded by subTest; the loop continues ---
                self.assertIsNone(judge_error, f"[{fixture['id']}] judge failed: {judge_error}")
                self.assertTrue(
                    cited_ok, f"[{fixture['id']}] a lead cites a document not in the case"
                )
                self.assertTrue(terms_ok, f"[{fixture['id']}] a lead contains accusatory language")
                if fixture["expect_clean"]:
                    self.assertEqual(
                        len(leads),
                        0,
                        f"[{fixture['id']}] negative control produced {len(leads)} leads",
                    )
                thr = fixture["thresholds"]
                self.assertGreaterEqual(
                    faith,
                    thr["faithfulness"],
                    f"[{fixture['id']}] faithfulness {faith:.2f} < {thr['faithfulness']}",
                )
                self.assertLessEqual(
                    orr,
                    thr["overreach"],
                    f"[{fixture['id']}] overreach {orr:.2f} > {thr['overreach']}",
                )

    def _print_scorecard(self, fixture, leads, faith_flags, over_flags, faith, orr):
        self._safe_print(f"\n=== {fixture['id']} — {len(leads)} lead(s) ===")
        aligned = len(faith_flags) == len(over_flags) == len(leads)
        for i, lead in enumerate(leads):
            faith_mark = ("✓" if faith_flags[i] else "✗") if aligned else "?"
            over_mark = ("⚠" if over_flags[i] else "·") if aligned else "?"
            self._safe_print(f"  [{faith_mark} support][{over_mark} overreach] {lead.title[:70]}")
        self._safe_print(f"  faithfulness={faith:.2f}  overreach={orr:.2f}")

    @staticmethod
    def _safe_print(line: str) -> None:
        """Print scorecard lines without crashing on a legacy (cp1252) console."""
        try:
            print(line)
        except UnicodeEncodeError:
            print(line.encode("ascii", "replace").decode("ascii"))
