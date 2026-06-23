import { describe, it, expect } from "vitest";
import { threadReadiness } from "./threadReadiness";

// Base-gap fixture: LEGACY_NARRATIVE so the base-gap path is tested in isolation
// (no element checks). Mirrors a grandfathered, doc-only-can-be-ready thread.
const base = {
  status: "CONFIRMED" as const,
  evidence_weight: "DOCUMENTED" as const,
  overreach_reviewed: true,
  document_links: [{ document_id: "d1", document_filename: "x", page_reference: "", context_note: "" }],
  gate_version: "LEGACY_NARRATIVE" as const,
};

// gate_version-aware helpers (Phase 4B). Inherits base's typed document_links; each
// ASSERTION_V1 test overrides gate_version + elements explicitly.
const baseV1 = { ...base };
const assertion = (over: Partial<any> = {}) => ({
  element_type: "ASSERTION", text: "x", handoff_ready: false, citations: [], ...over,
});

describe("threadReadiness", () => {
  it("is ready when all referral-grade conditions are met", () => {
    expect(threadReadiness(base)).toEqual({ ready: true, gaps: [], summary: "All referral-grade conditions met." });
  });
  it("accepts TRACED weight as ready (not only DOCUMENTED)", () => {
    expect(threadReadiness({ ...base, evidence_weight: "TRACED" }).ready).toBe(true);
  });
  it("reports no cited sources", () => {
    expect(threadReadiness({ ...base, document_links: [] })).toMatchObject({
      ready: false, summary: expect.stringContaining("No cited sources"),
    });
  });
  it("reports weight below Documented", () => {
    expect(threadReadiness({ ...base, evidence_weight: "SPECULATIVE" })).toMatchObject({
      ready: false, summary: expect.stringContaining("Evidence weight below Documented"),
    });
  });
  it("reports overreach not reviewed", () => {
    expect(threadReadiness({ ...base, overreach_reviewed: false })).toMatchObject({
      ready: false, summary: expect.stringContaining("Overreach not reviewed"),
    });
  });
  it("reports not yet substantiated", () => {
    expect(threadReadiness({ ...base, status: "NEEDS_EVIDENCE" })).toMatchObject({
      ready: false, summary: expect.stringContaining("Not yet substantiated"),
    });
  });

  // The dock reads gaps[0]; the inspector reads summary. Pin both: gaps is the structured
  // contract (no string parsing), summary is exactly the gaps joined by " · ".
  it("returns structured gaps plus a joined summary", () => {
    const r = threadReadiness({ ...base, document_links: [], status: "NEEDS_EVIDENCE" });
    expect(r.ready).toBe(false);
    expect(r.gaps[0]).toBe("No cited sources");
    expect(r.gaps).toContain("Not yet substantiated");
    expect(r.summary).toBe(r.gaps.join(" · "));
  });

  // --- gate_version-aware (Phase 4B) ---

  it("ASSERTION_V1: cited + handoff_ready assertion is ready", () => {
    const r = threadReadiness({
      ...baseV1, gate_version: "ASSERTION_V1",
      elements: [assertion({ handoff_ready: true, citations: [{}] })],
    } as any);
    expect(r.ready).toBe(true);
  });

  it("ASSERTION_V1: cited but no handoff_ready leaves a gap", () => {
    const r = threadReadiness({
      ...baseV1, gate_version: "ASSERTION_V1",
      elements: [assertion({ citations: [{}] })],
    } as any);
    expect(r.ready).toBe(false);
    expect(r.gaps).toContain("No handoff-ready claim");
  });

  it("ASSERTION_V1: handoff_ready but no cited assertion leaves a gap", () => {
    const r = threadReadiness({
      ...baseV1, gate_version: "ASSERTION_V1",
      elements: [assertion({ handoff_ready: true })],
    } as any);
    expect(r.ready).toBe(false);
    expect(r.gaps).toContain("No cited assertion");
  });

  it("ASSERTION_V1: no elements leaves both assertion gaps", () => {
    const r = threadReadiness({
      ...baseV1, gate_version: "ASSERTION_V1",
      elements: [],
    } as any);
    expect(r.ready).toBe(false);
    expect(r.gaps).toContain("No cited assertion");
    expect(r.gaps).toContain("No handoff-ready claim");
  });

  it("ASSERTION_V1: empty-text assertion does not satisfy cited gap", () => {
    const r = threadReadiness({
      ...baseV1, gate_version: "ASSERTION_V1",
      elements: [assertion({ text: "   ", citations: [{}], handoff_ready: true })],
    } as any);
    expect(r.ready).toBe(false);
    expect(r.gaps).toContain("No cited assertion");
    expect(r.gaps).toContain("No handoff-ready claim");
  });

  it("LEGACY_NARRATIVE: doc-only is ready (grandfathered)", () => {
    const r = threadReadiness({ ...baseV1, gate_version: "LEGACY_NARRATIVE", elements: [] } as any);
    expect(r.ready).toBe(true);
  });

  it("LEGACY_NARRATIVE: base gaps still apply", () => {
    const r = threadReadiness({
      ...baseV1, gate_version: "LEGACY_NARRATIVE", elements: [],
      status: "NEEDS_EVIDENCE",
    } as any);
    expect(r.ready).toBe(false);
    expect(r.gaps).toContain("Not yet substantiated");
  });

  it("absent gate_version defaults to the strict ASSERTION_V1 path (never falsely ready)", () => {
    // Omit gate_version + elements entirely: must take the strict branch and report
    // the assertion gaps, matching the backend ASSERTION_V1 model default.
    const r = threadReadiness({
      status: "CONFIRMED", evidence_weight: "DOCUMENTED", overreach_reviewed: true,
      document_links: [{ document_id: "d1", document_filename: "x", page_reference: "", context_note: "" }],
    });
    expect(r.ready).toBe(false);
    expect(r.gaps).toEqual(["No cited assertion", "No handoff-ready claim"]);
  });
});
