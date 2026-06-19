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
    PersonOrganization,
    PropertyTransaction,
    Relationship,
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


_LEVEL_LABEL = {
    "observed": "Observed relationship",
    "documented": "Documented relationship",
    "repeated": "Repeated relationship",
    "material": "Material relationship",
}


def _collect_co_mentions(case, subjects, evidence):
    """Shared-document co-mentions → co_mentioned evidence (mirrors /graph/)."""
    doc_subjects = {}
    for pd in PersonDocument.objects.filter(person__case=case):
        doc_subjects.setdefault(str(pd.document_id), []).append(str(pd.person_id))
    for od in OrgDocument.objects.filter(org__case=case):
        doc_subjects.setdefault(str(od.document_id), []).append(str(od.org_id))

    for doc_id, members in doc_subjects.items():
        present = [m for m in members if m in subjects]
        for i, a in enumerate(present):
            for b in present[i + 1 :]:
                lo, hi, _ = pair_edge_id(a, b)
                ev = evidence.setdefault((lo, hi), _new_evidence())
                if doc_id not in ev["doc_ids"]:
                    ev["doc_ids"].add(doc_id)
                    ev["relationship_types"].add("CO_APPEARS_IN")
                    ev["evidence_refs"].append(
                        {
                            "kind": "source_document",
                            "document_id": doc_id,
                            "label": "Shared source document",
                            "category": "co_mentioned",
                        }
                    )
                    ev["underlying"].append(
                        {
                            "kind": "CO_APPEARS_IN",
                            "label": "Co-appears in document",
                            "source": "co_mention",
                            "source_id": doc_id,
                        }
                    )


def _collect_roles(case, subjects, evidence):
    """PersonOrganization officer/board/employee roles → formal_role evidence."""
    qs = PersonOrganization.objects.filter(person__case=case).select_related("person", "org")
    for po in qs:
        a, b = str(po.person_id), str(po.org_id)
        if a not in subjects or b not in subjects:
            continue
        lo, hi, _ = pair_edge_id(a, b)
        ev = evidence.setdefault((lo, hi), _new_evidence())
        ev["role_count"] += 1
        ev["relationship_types"].add("OFFICER_OF")
        ev["underlying"].append(
            {
                "kind": "OFFICER_OF",
                "label": po.role or "Member",
                "source": "person_org",
                "source_id": str(po.id),
            }
        )


def _collect_transactions(case, subjects, evidence):
    """Summarize buyer<->seller property transactions into subject-pair edges.

    Properties are NOT nodes; the transaction is attributed to the buyer/seller
    subject pair. A transaction with only one side resolving to a case subject
    contributes no edge (spec §"Property transaction summarization").
    """
    qs = PropertyTransaction.objects.filter(property__case=case).select_related("property")
    for tx in qs:
        buyer = str(tx.buyer_id) if tx.buyer_id else None
        seller = str(tx.seller_id) if tx.seller_id else None
        if not buyer or not seller:
            continue
        if buyer not in subjects or seller not in subjects:
            continue
        lo, hi, _ = pair_edge_id(buyer, seller)
        ev = evidence.setdefault((lo, hi), _new_evidence())
        ev["transaction_count"] += 1
        ev["relationship_types"].add("PURCHASED")
        prop_label = tx.property.address or tx.property.parcel_number or "property"
        ev["evidence_refs"].append(
            {
                "kind": "property_transaction",
                "document_id": str(tx.document_id) if tx.document_id else None,
                "label": f"Transaction — {prop_label}",
                "category": "transaction",
            }
        )
        ev["underlying"].append(
            {
                "kind": "PURCHASED",
                "label": f"{tx.buyer_name or 'Buyer'} ← {tx.seller_name or 'Seller'}",
                "source": "property_transaction",
                "source_id": str(tx.id),
            }
        )


def _collect_relationships(case, subjects, evidence):
    """Manual/person Relationship rows → family_or_personal evidence."""
    qs = Relationship.objects.filter(case=case).select_related("person_a", "person_b")
    for rel in qs:
        a, b = str(rel.person_a_id), str(rel.person_b_id)
        if a not in subjects or b not in subjects:
            continue
        lo, hi, _ = pair_edge_id(a, b)
        ev = evidence.setdefault((lo, hi), _new_evidence())
        ev["has_family"] = True
        ev["relationship_types"].add(rel.relationship_type)
        ev["underlying"].append(
            {
                "kind": rel.relationship_type,
                "label": rel.get_relationship_type_display(),
                "source": "manual_relationship",
                "source_id": str(rel.id),
            }
        )


def _build_edges(evidence, subjects):
    edges = []
    for (lo, hi), ev in evidence.items():
        strength = score_evidence(ev)
        edges.append(
            {
                "id": f"{lo}__{hi}",
                "source": lo,
                "target": hi,
                "relationship": "SUMMARY",
                "label": _LEVEL_LABEL[strength["level"]],
                "state": strength["level"],
                "strength": strength,
                "evidence_refs": ev["evidence_refs"],
                "thread_refs": ev["thread_refs"],
                "underlying_relationships": ev["underlying"],
            }
        )
    return edges


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
    evidence = {}
    _collect_co_mentions(case, subjects, evidence)
    _collect_roles(case, subjects, evidence)
    _collect_transactions(case, subjects, evidence)
    _collect_relationships(case, subjects, evidence)
    edges = _build_edges(evidence, subjects)
    nodes = list(subjects.values())
    return {
        "case_id": str(case.id),
        "nodes": nodes,
        "edges": edges,
        "stats": _build_stats(nodes, edges),
    }
