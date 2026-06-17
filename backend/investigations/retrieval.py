from __future__ import annotations

import re

from investigations.models import Document


def _terms(query: str) -> list[str]:
    return [
        term.lower()
        for term in re.findall(r"[A-Za-z0-9][A-Za-z0-9-]+", query)
    ]


def _snippet(text: str, query: str, terms: list[str], width: int = 220) -> tuple[str, int]:
    lower = text.lower()
    q = query.lower().strip()
    idx = lower.find(q) if q else -1
    if idx < 0:
        positions = [lower.find(term) for term in terms if lower.find(term) >= 0]
        idx = min(positions) if positions else 0
    start = max(0, idx - width)
    end = min(len(text), idx + len(query) + width)
    return text[start:end], idx


def _score(text: str, query: str, terms: list[str]) -> int:
    lower = text.lower()
    score = 0
    if query.lower().strip() in lower:
        score += 25
    for term in terms:
        score += lower.count(term) * 5
    return score


def search_case_documents(case, query: str, limit: int = 10) -> dict:
    if not query or not query.strip():
        return {"query": query, "match_count": 0, "results": []}

    terms = _terms(query)

    candidates = (
        Document.objects.filter(case=case)
        .exclude(extracted_text__isnull=True)
        .exclude(extracted_text__exact="")
    )

    ranked = []
    for doc in candidates:
        text = doc.extracted_text or ""
        score = _score(text, query, terms)
        if score <= 0:
            continue
        snippet, match_position = _snippet(text, query, terms)
        ranked.append((score, doc.uploaded_at, doc, snippet, match_position))

    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    results = [
        {
            "document_id": str(doc.pk),
            "display_name": doc.display_name or doc.filename,
            "doc_type": doc.doc_type,
            "sha256": doc.sha256_hash,
            "snippet": snippet,
            "match_position": match_position,
            "score": score,
        }
        for score, _uploaded_at, doc, snippet, match_position in ranked[:limit]
    ]
    return {"query": query, "match_count": len(results), "results": results}
