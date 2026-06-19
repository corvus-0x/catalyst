"""Case Map builder — summarized subject-pair relationship graph.

One summarized edge per unordered subject pair, with an explainable strength
object. Separate from the raw /graph/ endpoint. See
docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md §4.
"""

from collections import Counter

from django.utils import timezone

from .models import (
    Organization,
    OrganizationStatus,
    OrgDocument,
    Person,
    PersonDocument,
)


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
