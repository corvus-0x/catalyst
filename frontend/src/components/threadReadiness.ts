import type { FindingItem } from "../types";

type ReadinessInput = Pick<
  FindingItem,
  "status" | "evidence_weight" | "overreach_reviewed" | "document_links"
>;

/** The single referral-grade gap definition shared by ThreadInspector and the Thread Dock.
 *  Mirrors referral_grade.py: CONFIRMED ∧ ≥1 cited doc ∧ weight ∈ {DOCUMENTED, TRACED} ∧ overreach_reviewed.
 *
 *  Returns the gaps as a STRUCTURED array (consumers pick gaps[0] without parsing) AND a pre-joined
 *  summary for full-sentence display. The dock reads gaps[0]; ThreadInspector reads summary. No
 *  consumer splits the string, so the separator is not a cross-component contract. */
export function threadReadiness(f: ReadinessInput): { ready: boolean; gaps: string[]; summary: string } {
  const gaps: string[] = [];
  if (f.document_links.length === 0) gaps.push("No cited sources");
  if (!["DOCUMENTED", "TRACED"].includes(f.evidence_weight)) gaps.push("Evidence weight below Documented");
  if (!f.overreach_reviewed) gaps.push("Overreach not reviewed");
  if (f.status !== "CONFIRMED") gaps.push("Not yet substantiated");
  if (gaps.length === 0) return { ready: true, gaps: [], summary: "All referral-grade conditions met." };
  return { ready: false, gaps, summary: gaps.join(" · ") };
}
