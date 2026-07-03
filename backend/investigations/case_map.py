"""Case Map builder — summarized subject-pair relationship graph.

One summarized edge per unordered subject pair, with an explainable strength
object. Separate from the raw /graph/ endpoint. See
docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md §4.
"""

import logging

from django.utils import timezone

from .models import (
    FinancialInstrument,
    Finding,
    FindingStatus,
    OrgAddress,
    Organization,
    OrganizationStatus,
    OrgDocument,
    Person,
    PersonAddress,
    PersonDocument,
    PersonOrganization,
    PropertyTransaction,
    Relationship,
    RelationshipType,
)
from .referral_grade import is_referral_grade

logger = logging.getLogger(__name__)


def _snapshot(finding):
    """`evidence_snapshot` as a dict, guarding null/corrupted non-dict values.

    The field is a JSONField; `None` and `{}` are legitimate empty states, but a
    corrupted row (e.g. a list or string) would crash the `.get(...)` chains in
    thread inference. Coerce anything non-dict to an empty dict.
    """
    snap = finding.evidence_snapshot
    return snap if isinstance(snap, dict) else {}


# ── Scoring constants (spec §"First Scoring Formula") ──
CO_MENTION_FIRST = 10
CO_MENTION_EACH = 5
CO_MENTION_CAP = 20  # cap on the *additional*-document points (not the total ceiling of 30)
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

    # Material cap (spec §4): raw evidence alone caps at `repeated`; `material`
    # also needs >=1 substantiated thread. We approximate the spec's "thread
    # relies on this relationship" by "thread implicates both subjects" — the
    # thread_ref is only present on this pair because the finding named both.
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
            "metadata": {"thread_count": 0, "document_count": 0, "transaction_count": 0},
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
            "metadata": {"thread_count": 0, "document_count": 0, "transaction_count": 0},
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
        # Each doc_id is processed once and each unordered (a, b) pair is visited
        # once, so a given (pair, doc_id) is unique — no dedup guard needed.
        for i, a in enumerate(present):
            for b in present[i + 1 :]:
                lo, hi, _ = pair_edge_id(a, b)
                ev = evidence.setdefault((lo, hi), _new_evidence())
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
    contributes no edge (spec §"Property transaction summarization"), but DOES
    credit the resolved subject's `metadata.transaction_count` — the spec's
    one-sided "metadata credit" (1A fast-follow). Two-sided transactions credit
    both nodes. The no-edge skip stays debug-logged so it can be told apart
    from a data bug.
    """
    qs = PropertyTransaction.objects.filter(property__case=case).select_related("property")
    for tx in qs:
        buyer = str(tx.buyer_id) if tx.buyer_id else None
        seller = str(tx.seller_id) if tx.seller_id else None
        # dict.fromkeys = ordered dedup: a self-transaction (buyer == seller)
        # credits the subject's metadata ONCE and never makes a self-loop edge
        # (a pair map has no meaningful self-pair; the txn stays inspectable
        # via the node's transaction_count).
        resolved = list(dict.fromkeys(s for s in (buyer, seller) if s and s in subjects))
        for sid in resolved:
            subjects[sid]["metadata"]["transaction_count"] += 1
        if len(resolved) < 2:
            logger.debug(
                "case_map: tx %s made no edge — sides did not resolve to a distinct "
                "case-subject pair (buyer=%s seller=%s); metadata credit applied to "
                "%d node(s)",
                tx.id,
                buyer,
                seller,
                len(resolved),
            )
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


# Relationship types that read as business associations rather than
# family/personal ties (1A fast-follow split). Everything else — including
# OTHER, which carries no type signal — stays in the family_or_personal bucket.
_BUSINESS_RELATIONSHIP_TYPES = frozenset(
    {
        RelationshipType.BUSINESS_PARTNER,
        RelationshipType.CO_OFFICER,
        RelationshipType.ATTORNEY_CLIENT,
        RelationshipType.EMPLOYER_EMPLOYEE,
    }
)


def _collect_relationships(case, subjects, evidence):
    """Manual/person Relationship rows → family_or_personal OR business_association.

    The bucket is decided per-row by `relationship_type`
    (_BUSINESS_RELATIONSHIP_TYPES); a pair with both a SPOUSE and a
    BUSINESS_PARTNER row scores both categories.
    """
    qs = Relationship.objects.filter(case=case).select_related("person_a", "person_b")
    for rel in qs:
        a, b = str(rel.person_a_id), str(rel.person_b_id)
        if a not in subjects or b not in subjects:
            continue
        lo, hi, _ = pair_edge_id(a, b)
        ev = evidence.setdefault((lo, hi), _new_evidence())
        if rel.relationship_type in _BUSINESS_RELATIONSHIP_TYPES:
            ev["has_business"] = True
        else:
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


def _collect_shared_addresses(case, subjects, evidence):
    """Subjects linked to the same normalized Address → shared_address evidence.

    PersonAddress + OrgAddress rows are grouped by address; every unordered
    subject pair sharing an address gets `has_shared_address` (one flag per
    pair regardless of how many addresses they share — the scorer awards
    SHARED_ADDRESS_POINTS once), plus one evidence_ref/underlying entry per
    shared address for inspector drill-down.
    """
    addr_subjects = {}
    addr_labels = {}
    for pa in PersonAddress.objects.filter(person__case=case).select_related("address"):
        sid = str(pa.person_id)
        if sid in subjects:
            aid = str(pa.address_id)
            addr_subjects.setdefault(aid, set()).add(sid)
            addr_labels[aid] = pa.address.raw_text
    for oa in OrgAddress.objects.filter(org__case=case).select_related("address"):
        sid = str(oa.org_id)
        if sid in subjects:
            aid = str(oa.address_id)
            addr_subjects.setdefault(aid, set()).add(sid)
            addr_labels[aid] = oa.address.raw_text
    for aid, members in addr_subjects.items():
        ordered = sorted(members)
        for i, a in enumerate(ordered):
            for b in ordered[i + 1 :]:
                lo, hi, _ = pair_edge_id(a, b)
                ev = evidence.setdefault((lo, hi), _new_evidence())
                ev["has_shared_address"] = True
                ev["relationship_types"].add("SHARED_ADDRESS")
                ev["evidence_refs"].append(
                    {
                        "kind": "shared_address",
                        "document_id": None,
                        "label": f"Shared address — {addr_labels[aid]}",
                        "category": "shared_address",
                    }
                )
                ev["underlying"].append(
                    {
                        "kind": "SHARED_ADDRESS",
                        "label": addr_labels[aid],
                        "source": "shared_address",
                        "source_id": aid,
                    }
                )


def _collect_financial_links(case, subjects, evidence):
    """FinancialInstrument debtor <-> secured-party pairs → financial_link evidence.

    The instrument connects the debtor and the secured party (UCC/lien/loan);
    the signer is deliberately NOT paired — signing is captured as a formal
    role elsewhere and pairing it here would over-connect counsel/officers.
    An instrument with only one side resolving to a case subject contributes
    nothing (mirrors the transaction collector's two-sided rule).
    """
    for fi in FinancialInstrument.objects.filter(case=case):
        debtor = str(fi.debtor_id) if fi.debtor_id else None
        secured = str(fi.secured_party_id) if fi.secured_party_id else None
        if (
            not debtor
            or not secured
            or debtor == secured
            or debtor not in subjects
            or secured not in subjects
        ):
            logger.debug(
                "case_map: instrument %s made no edge — sides did not resolve to a "
                "distinct case-subject pair (debtor=%s secured_party=%s)",
                fi.id,
                debtor,
                secured,
            )
            continue
        type_label = fi.get_instrument_type_display()
        label = f"{type_label} {fi.filing_number}" if fi.filing_number else type_label
        lo, hi, _ = pair_edge_id(debtor, secured)
        ev = evidence.setdefault((lo, hi), _new_evidence())
        ev["has_financial"] = True
        ev["relationship_types"].add("FINANCIAL_LINK")
        ev["evidence_refs"].append(
            {
                "kind": "financial_instrument",
                "document_id": None,
                "label": label,
                "category": "financial_link",
            }
        )
        ev["underlying"].append(
            {
                "kind": "FINANCIAL_LINK",
                "label": label,
                "source": "financial_instrument",
                "source_id": str(fi.id),
            }
        )


def _txn_subject_pairs(case):
    """Map transaction id -> set of its buyer/seller subject ids (as strings).

    Lets thread inference recover a subject pair from a Finding that references a
    transaction only by id (e.g. SR-025's evidence_snapshot.transaction_examples).
    """
    pairs = {}
    for tx in PropertyTransaction.objects.filter(property__case=case):
        ids = set()
        if tx.buyer_id:
            ids.add(str(tx.buyer_id))
        if tx.seller_id:
            ids.add(str(tx.seller_id))
        pairs[str(tx.id)] = ids
    return pairs


def _subject_ids_from_finding(finding, subjects, txn_pairs):
    """Infer the case-subject ids a Finding implicates, from three sources.

    1. FindingEntity links (person/organization).
    2. evidence_snapshot subject-id keys: buyer_id, seller_id, matched_entity_id.
    3. evidence_snapshot transaction references resolved to buyer/seller subjects.

    Only ids that resolve to an actual case subject are returned.
    """
    ids = set()
    for el in finding.entity_links.all():
        # Rules that trigger on a property/financial_instrument link that record
        # as a FindingEntity — skip non-subject entity types explicitly (their
        # subjects come from the evidence_snapshot paths below).
        if el.entity_type not in ("person", "organization"):
            continue
        sid = str(el.entity_id)
        if sid in subjects:
            ids.add(sid)

    snap = _snapshot(finding)
    for key in ("buyer_id", "seller_id", "matched_entity_id"):
        val = snap.get(key)
        if val and str(val) in subjects:
            ids.add(str(val))

    txn_ids = []
    if snap.get("transaction_id"):
        txn_ids.append(str(snap["transaction_id"]))
    for ex in snap.get("transaction_examples") or []:
        if isinstance(ex, dict) and ex.get("transaction_id"):
            txn_ids.append(str(ex["transaction_id"]))
    for tid in txn_ids:
        for sid in txn_pairs.get(tid, ()):
            if sid in subjects:
                ids.add(sid)
    return ids


def _collect_threads(case, subjects, evidence):
    """Attach non-dismissed Findings to every subject pair they implicate.

    Subjects are inferred via _subject_ids_from_finding (FindingEntity +
    evidence_snapshot + underlying transactions), because real rules often
    trigger on a property/document, not on the subjects themselves. Also sets the
    per-node thread flags (`has_active_thread`, `has_substantiated_thread`) and
    `metadata.thread_count` — this is the only place those are populated.

    `document_links` is prefetched so `is_referral_grade`'s `.exists()` check uses
    the prefetch cache instead of issuing one query per finding (avoids an N+1).
    """
    from .signal_rules import _RULE_TO_SIGNAL_TYPE

    txn_pairs = _txn_subject_pairs(case)
    findings = (
        Finding.objects.filter(case=case)
        .exclude(status=FindingStatus.DISMISSED)
        .prefetch_related("entity_links", "document_links")
    )
    for f in findings:
        subj_ids = sorted(_subject_ids_from_finding(f, subjects, txn_pairs))
        if not subj_ids:
            # A rule-generated finding that resolves to no case subject never
            # reaches the Case Map — surface it so it can be diagnosed (vs. a
            # silent drop). Manual findings with no subjects are expected/quiet.
            if f.rule_id:
                logger.warning(
                    "case_map: finding %s (rule=%s, status=%s) resolved to zero "
                    "subject pairs — check entity_links and evidence_snapshot keys",
                    f.id,
                    f.rule_id,
                    f.status,
                )
            continue
        handoff = is_referral_grade(f)
        for sid in subj_ids:
            node = subjects[sid]
            node["flags"]["has_active_thread"] = True
            node["metadata"]["thread_count"] += 1
            if f.status == FindingStatus.CONFIRMED:
                node["flags"]["has_substantiated_thread"] = True
        snap = _snapshot(f)
        ref = {
            "thread_id": str(f.id),
            "title": f.title,
            "status": f.status,
            "severity": f.severity,
            "rule_id": f.rule_id,
            "signal_type": snap.get("signal_type") or _RULE_TO_SIGNAL_TYPE.get(f.rule_id, ""),
            "handoff_ready": handoff,
        }
        for i, a in enumerate(subj_ids):
            for b in subj_ids[i + 1 :]:
                lo, hi, _ = pair_edge_id(a, b)
                evidence.setdefault((lo, hi), _new_evidence())["thread_refs"].append(ref)


def _build_edges(evidence):
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
    by_level = {"observed": 0, "documented": 0, "repeated": 0, "material": 0}
    for e in edges:
        by_level[e["strength"]["level"]] += 1
    return {
        "subject_count": len(nodes),
        "edge_count": len(edges),
        "by_level": by_level,
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
    _collect_shared_addresses(case, subjects, evidence)
    _collect_financial_links(case, subjects, evidence)
    _collect_threads(case, subjects, evidence)
    edges = _build_edges(evidence)
    nodes = list(subjects.values())
    return {
        "case_id": str(case.id),
        "nodes": nodes,
        "edges": edges,
        "stats": _build_stats(nodes, edges),
    }
