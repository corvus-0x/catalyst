"""Seed a golden fixture into the DB as a real Case — pure ORM, no pipeline.

Skips OCR/extraction so the eval isolates AI-judgment quality from extraction
quality: documents are created with their text already in `extracted_text`.
"""

from __future__ import annotations

import hashlib
from typing import Any

from investigations.models import (
    Case,
    Document,
    FinancialSnapshot,
    OcrStatus,
    Organization,
    Person,
)


def _sha256(fixture_doc: dict[str, Any]) -> str:
    """Use an explicit hash if the fixture set one, else derive one from the
    document's filename and text so distinct documents get distinct hashes (the
    UNIQUE(case, sha256_hash) constraint) and a future duplicate-document
    fixture can force a collision by reusing both or setting `sha256`.
    """
    if fixture_doc.get("sha256"):
        return fixture_doc["sha256"]
    seed = f"{fixture_doc['filename']}\0{fixture_doc.get('extracted_text', '')}".encode("utf-8")
    return hashlib.sha256(seed).hexdigest()


def seed_case(fixture: dict[str, Any]) -> Case:
    """Insert a Case plus its persons, organizations, documents, and financial
    snapshots from a fixture dict. Returns the Case. No Claude, no OCR.
    """
    case = Case.objects.create(name=fixture["case_name"], status="ACTIVE")

    persons_by_key: dict[str, Person] = {}
    for p in fixture.get("persons", []):
        persons_by_key[p["key"]] = Person.objects.create(
            case=case,
            full_name=p["full_name"],
            role_tags=list(p.get("role_tags", [])),
        )

    orgs_by_key: dict[str, Organization] = {}
    for o in fixture.get("organizations", []):
        orgs_by_key[o["key"]] = Organization.objects.create(
            case=case,
            name=o["name"],
            ein=o.get("ein", ""),
            org_type=o.get("org_type", "OTHER"),
        )

    docs_by_key: dict[str, Document] = {}
    for d in fixture.get("documents", []):
        text = d.get("extracted_text", "")
        docs_by_key[d["key"]] = Document.objects.create(
            case=case,
            filename=d["filename"],
            file_path=f"eval/{case.id}/{d['filename']}",
            sha256_hash=_sha256(d),
            file_size=max(len(text.encode("utf-8")), 1),
            doc_type=d.get("doc_type", "OTHER"),
            ocr_status=OcrStatus.COMPLETED,
            extracted_text=text,
        )

    for s in fixture.get("financial_snapshots", []):
        FinancialSnapshot.objects.create(
            case=case,
            document=docs_by_key[s["doc"]],
            organization=orgs_by_key[s["org"]] if s.get("org") else None,
            tax_year=s["tax_year"],
            total_revenue=s.get("total_revenue"),
            total_expenses=s.get("total_expenses"),
            officer_compensation_total=s.get("officer_compensation_total"),
            related_party_disclosed=s.get("related_party_disclosed"),
            has_coi_policy=s.get("has_coi_policy"),
        )

    return case
