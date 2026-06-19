"""Case Map builder — summarized subject-pair relationship graph.

One summarized edge per unordered subject pair, with an explainable strength
object. Separate from the raw /graph/ endpoint. See
docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md §4.
"""

from collections import Counter

from django.utils import timezone

from .models import (
    FindingStatus,
    Organization,
    OrganizationStatus,
    OrgDocument,
    Person,
    PersonDocument,
)

# ── Scoring constants (spec §"First Scoring Formula") ──
CO_MENTION_FIRST = 10
CO_MENTION_EACH = 5
CO_MENTION_CAP = 20
ROLE_POINTS = 30
TRANSACTION_EACH = 25
TRANSACTION_CAP = 50
FAMILY_POINTS = 25
BUSINESS_POINTS = 25
SHARED_ADDRESS_POINTS = 15
FINANCIAL_POINTS = 25
THREAD_DEVELOPING = 10
THREAD_SUBSTANTIATED = 25
THREAD_HANDOFF = 35

LEVEL_DOCUMENTED = 20
LEVEL_REPEATED = 50
LEVEL_MATERIAL = 80


def _new_evidence():
    """The locked per-pair evidence field set. Collectors populate these."""
    return {
        "doc_ids": set(),
        "role_count": 0,
        "transaction_count": 0,
        "has_family": False,
        "has_business": False,
        "has_shared_address": False,
        "has_financial": False,
        "relationship_types": set(),
        "evidence_refs": [],
        "underlying": [],
        "thread_refs": [],  # dicts: {status, handoff_ready, ...}
    }


def _plural(n):
    return "" if n == 1 else "s"


def score_evidence(ev):
    """Turn a per-pair evidence dict into the locked strength object (spec §4)."""
    score = 0
    categories = []
    reasons = []

    n_docs = len(ev["doc_ids"])
    if n_docs:
        score += CO_MENTION_FIRST + min((n_docs - 1) * CO_MENTION_EACH, CO_MENTION_CAP)
        categories.append("co_mentioned")
        reasons.append(f"Appears together in {n_docs} source document{_plural(n_docs)}")
    if ev["role_count"]:
        score += ROLE_POINTS
        categories.append("formal_role")
        reasons.append("Formal role documented")
    if ev["transaction_count"]:
        n = ev["transaction_count"]
        score += min(n * TRANSACTION_EACH, TRANSACTION_CAP)
        categories.append("transaction")
        reasons.append(f"{n} property transaction{_plural(n)} connect these subjects")
    if ev["has_family"]:
        score += FAMILY_POINTS
        categories.append("family_or_personal")
        reasons.append("Family or personal relationship recorded")
    if ev["has_business"]:
        score += BUSINESS_POINTS
        categories.append("business_association")
        reasons.append("Business association recorded")
    if ev["has_shared_address"]:
        score += SHARED_ADDRESS_POINTS
        categories.append("shared_address")
        reasons.append("Shared address appears in records")
    if ev["has_financial"]:
        score += FINANCIAL_POINTS
        categories.append("financial_link")
        reasons.append("Financial link connects these subjects")

    substantiated = 0
    handoff = False
    developing = 0
    for t in ev["thread_refs"]:
        if t.get("handoff_ready"):
            score += THREAD_HANDOFF
            handoff = True
            substantiated += 1
        elif t.get("status") == FindingStatus.CONFIRMED:
            score += THREAD_SUBSTANTIATED
            substantiated += 1
        else:
            score += THREAD_DEVELOPING
            developing += 1
    if ev["thread_refs"]:
        categories.append("thread_referenced")
        if substantiated:
            reasons.append(
                f"Referenced by {substantiated} substantiated thread{_plural(substantiated)}"
            )
        if developing:
            reasons.append(f"Referenced by {developing} developing thread{_plural(developing)}")

    if score >= LEVEL_MATERIAL and substantiated >= 1:
        level = "material"
    elif score >= LEVEL_REPEATED:
        level = "repeated"
    elif score >= LEVEL_DOCUMENTED:
        level = "documented"
    else:
        level = "observed"

    return {
        "score": score,
        "level": level,
        "categories": categories,
        "source_count": n_docs,
        "transaction_count": ev["transaction_count"],
        "role_count": ev["role_count"],
        "thread_count": len(ev["thread_refs"]),
        "substantiated_thread_count": substantiated,
        "handoff_included": handoff,
        "relationship_types": sorted(ev["relationship_types"]),
        "reasons": reasons,
    }


def pair_edge_id(id_a, id_b):
    """Stable, order-independent edge id for a subject pair."""
    lo, hi = sorted([str(id_a), str(id_b)])
    return lo, hi, f"{lo}__{hi}"


def _subject_index(case):
    """Map of subject id -> node dict for every Person and Organization."""
    idx = {}
    for p in Person.objects.filter(case=case):
        idx[str(p.id)] = {
            "id": str(p.id),
            "type": "person",
            "label": p.full_name,
            "subtype": None,
            "flags": {
                "status_unknown": False,
                "has_active_thread": False,
                "has_substantiated_thread": False,
            },
            "metadata": {"thread_count": 0, "document_count": 0},
        }
    for o in Organization.objects.filter(case=case):
        idx[str(o.id)] = {
            "id": str(o.id),
            "type": "organization",
            "label": o.name,
            "subtype": o.org_type,
            "flags": {
                # Neutral data-completeness flag — NOT a shell accusation (spec §10).
                "status_unknown": o.status == OrganizationStatus.UNKNOWN,
                "has_active_thread": False,
                "has_substantiated_thread": False,
            },
            "metadata": {"thread_count": 0, "document_count": 0},
        }
    for pd in PersonDocument.objects.filter(person__case=case):
        sid = str(pd.person_id)
        if sid in idx:
            idx[sid]["metadata"]["document_count"] += 1
    for od in OrgDocument.objects.filter(org__case=case):
        sid = str(od.org_id)
        if sid in idx:
            idx[sid]["metadata"]["document_count"] += 1
    return idx


def _build_stats(nodes, edges):
    by_level = Counter({"observed": 0, "documented": 0, "repeated": 0, "material": 0})
    for e in edges:
        by_level[e["strength"]["level"]] += 1
    return {
        "subject_count": len(nodes),
        "edge_count": len(edges),
        "by_level": dict(by_level),
        "material_edge_count": by_level["material"],
        "handoff_edge_count": sum(1 for e in edges if e["strength"]["handoff_included"]),
        "generated_at": timezone.now().isoformat(),
    }


def build_case_map(case):
    subjects = _subject_index(case)
    edges = []
    nodes = list(subjects.values())
    return {
        "case_id": str(case.id),
        "nodes": nodes,
        "edges": edges,
        "stats": _build_stats(nodes, edges),
    }
