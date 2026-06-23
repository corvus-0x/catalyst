import type { FindingItem } from "../types";

type ReadinessInput = Pick<
  FindingItem,
  "status" | "evidence_weight" | "overreach_reviewed" | "document_links"
> &
  Partial<Pick<FindingItem, "gate_version" | "elements">>;

/** Single referral-grade gap definition shared by ThreadInspector + Thread Dock.
 *  Mirrors referral_grade.py (Phase 4B dual-version).
 *
 *  Base gaps (both gate versions):
 *    CONFIRMED ∧ weight ∈ {DOCUMENTED, TRACED} ∧ overreach_reviewed ∧ ≥1 cited doc
 *
 *  ASSERTION_V1 adds (mirrors finding_has_cited_assertion + finding_has_handoff_ready_assertion):
 *    ≥1 ASSERTION with non-empty text ∧ ≥1 citation ("No cited assertion")
 *    ≥1 ASSERTION with non-empty text ∧ handoff_ready ("No handoff-ready claim")
 *
 *  LEGACY_NARRATIVE: base gaps only (grandfathered — doc-only can be ready).
 *
 *  gaps[0] = headline gap (dock reads this). summary = gaps joined by " · " (inspector reads this).
 *  Shape { ready, gaps, summary } MUST NOT CHANGE — consumers depend on it. */
export function threadReadiness(
  f: ReadinessInput,
): { ready: boolean; gaps: string[]; summary: string } {
  const gaps: string[] = [];

  // Base gaps — same for all gate versions
  if (f.document_links.length === 0) gaps.push("No cited sources");
  if (!["DOCUMENTED", "TRACED"].includes(f.evidence_weight)) {
    gaps.push("Evidence weight below Documented");
  }
  if (!f.overreach_reviewed) gaps.push("Overreach not reviewed");
  if (f.status !== "CONFIRMED") gaps.push("Not yet substantiated");

  // ASSERTION_V1-only gaps — mirrors referral_grade.py is_referral_grade() ASSERTION_V1 branch.
  // gate_version defaults to ASSERTION_V1 (the backend default for new threads); when absent
  // treat as LEGACY_NARRATIVE so callers that pre-date Phase 4B are not broken.
  if ((f.gate_version ?? "LEGACY_NARRATIVE") === "ASSERTION_V1") {
    const elements = f.elements ?? [];
    const hasCited = elements.some(
      (e) => e.element_type === "ASSERTION" && e.text.trim() !== "" && e.citations.length > 0,
    );
    const hasHandoff = elements.some(
      (e) => e.element_type === "ASSERTION" && e.handoff_ready && e.text.trim() !== "",
    );
    if (!hasCited) gaps.push("No cited assertion");
    if (!hasHandoff) gaps.push("No handoff-ready claim");
  }
  // LEGACY_NARRATIVE: no extra gaps (grandfathered predicate)

  if (gaps.length === 0) return { ready: true, gaps: [], summary: "All referral-grade conditions met." };
  return { ready: false, gaps, summary: gaps.join(" · ") };
}
