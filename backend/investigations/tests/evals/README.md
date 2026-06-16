# AI-Lead Eval Harness

Measures whether Catalyst's AI Leads (`Finding`s with `source=AI` from
`analyze_case`) are **faithful** to their cited evidence and do not **overreach**
before that text reaches a referral.

## Run it

Pure unit tests (no Claude — run in CI):

    python manage.py test investigations.tests.evals --exclude-tag=eval

Full eval (live Claude — needs ANTHROPIC_API_KEY, excluded from CI):

    python manage.py test investigations.tests.evals.test_lead_quality --tag=eval

## What it asserts

- **Hard (deterministic):** every cited `Doc-N` resolves to a case document;
  no accusatory language survives; negative-control fixtures produce zero leads.
- **Measured (temp-0 LLM judge):** faithfulness ≥ 0.70, overreach ≤ 0.20
  (per-fixture thresholds in `lead_fixtures.py`).

## Sample scorecard

    === high_revenue_zero_comp — 1 lead(s) ===
      [✓ support][· overreach] High-revenue organization reports zero officer pay
      faithfulness=1.00  overreach=0.00
    === nominal_deed_trap — 1 lead(s) ===
      [✓ support][· overreach] Nominal-consideration deed warrants related-party review
      faithfulness=1.00  overreach=0.00
    === benign_clean_case — 0 lead(s) ===
      faithfulness=1.00  overreach=0.00

Results are written to `results/lead_eval.json` (gitignored).

## CI note

CI must run the suite with `--exclude-tag=eval` so the live-Claude test never
runs without a key. The pure tests (seeder, scorers, judge parsing) run normally.
