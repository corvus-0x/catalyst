"""LLM-as-judge for the AI-lead eval harness.

Two temperature-0 Claude calls (one per axis). Each receives the leads and the
exact evidence the generator saw, and returns a per-lead boolean. A parse
failure raises JudgeError so a broken judge fails the eval loudly rather than
passing silently.
"""

from __future__ import annotations

import json
from typing import Any

from investigations import ai_proxy

MODEL = ai_proxy.MODEL_SONNET


class JudgeError(RuntimeError):
    """The judge returned output that could not be parsed into per-lead flags."""


_SUPPORT_SYSTEM = (
    "You are the faithfulness judge for a fraud-investigation tool. You are given "
    "LEADS (each an index, a description, and a rationale) and the EVIDENCE the tool "
    "saw (document excerpts and structured context). For EACH lead decide: do the "
    "cited excerpts and structured context actually SUPPORT the description + "
    "rationale? A lead is supported only if the evidence substantiates it; if it "
    "asserts anything not present in the evidence, it is NOT supported. Respond with "
    'JSON only: {"results": [{"index": <int>, "supported": <bool>}, ...]} with one '
    "entry per lead."
)

_OVERREACH_SYSTEM = (
    "You are the overreach judge for a fraud-investigation tool. You are given LEADS "
    "(each an index, a description, and a rationale) and the CONTEXT the tool saw. A "
    "lead OVERREACHES if it: asserts a verdict or accusation as established fact "
    "(e.g. self-dealing, private benefit, wrongdoing) rather than a pattern to "
    "review; references an entity or dollar amount not present in the context; or "
    "states something the structured context contradicts. Surfacing a pattern and "
    "recommending review is NOT overreach. Respond with JSON only: "
    '{"results": [{"index": <int>, "overreaches": <bool>}, ...]} with one entry per lead.'
)


def _lead_payload(leads) -> list[dict[str, Any]]:
    return [
        {
            "index": i,
            "description": getattr(lead, "description", "") or "",
            "rationale": getattr(lead, "narrative", "") or "",
            "doc_refs": (lead.evidence_snapshot or {}).get("doc_refs", []),
        }
        for i, lead in enumerate(leads)
    ]


def _judge_call(system: str, payload: dict[str, Any]) -> dict[str, Any]:
    """One temperature-0 structured call. Raises JudgeError on unparseable JSON."""
    client = ai_proxy._get_client()
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        temperature=0,
        system=system,
        messages=[{"role": "user", "content": json.dumps(payload)}],
    )
    raw = (response.content[0].text or "").strip()
    if raw.startswith("```"):
        raw = "\n".join(
            line for line in raw.split("\n") if not line.strip().startswith("```")
        ).strip()
    try:
        return json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise JudgeError(f"Judge returned unparseable JSON: {exc}") from exc


def _flags_from(results: dict[str, Any], key: str, n: int) -> list[bool]:
    """Map a {"results": [{"index", <key>}]} payload to an ordered flag list."""
    by_index = {r.get("index"): bool(r.get(key)) for r in results.get("results", [])}
    if set(by_index) != set(range(n)):
        raise JudgeError(f"Judge results did not cover indices 0..{n - 1}: {sorted(by_index)}")
    return [by_index[i] for i in range(n)]


def judge_support(leads, context: dict[str, Any]) -> list[bool]:
    """Per-lead: is the lead supported by its cited evidence? Empty for no leads."""
    if not leads:
        return []
    payload = {
        "leads": _lead_payload(leads),
        "evidence": {
            "documents": context.get("documents", []),
            "entities": context.get("entities", {}),
            "financial_snapshots": context.get("financial_snapshots", []),
        },
    }
    return _flags_from(_judge_call(_SUPPORT_SYSTEM, payload), "supported", len(leads))


def judge_overreach(leads, context: dict[str, Any]) -> list[bool]:
    """Per-lead: does the lead assert beyond the context? Empty for no leads."""
    if not leads:
        return []
    payload = {
        "leads": _lead_payload(leads),
        "context": {
            "documents": context.get("documents", []),
            "entities": context.get("entities", {}),
            "financial_snapshots": context.get("financial_snapshots", []),
        },
    }
    return _flags_from(_judge_call(_OVERREACH_SYSTEM, payload), "overreaches", len(leads))
