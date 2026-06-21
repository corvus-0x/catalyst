import { describe, it, expect } from "vitest";
import { threadReadiness } from "./threadReadiness";

const base = {
  status: "CONFIRMED" as const,
  evidence_weight: "DOCUMENTED" as const,
  overreach_reviewed: true,
  document_links: [{ document_id: "d1", document_filename: "x", page_reference: "", context_note: "" }],
};

describe("threadReadiness", () => {
  it("is ready when all referral-grade conditions are met", () => {
    expect(threadReadiness(base)).toEqual({ ready: true, summary: "All referral-grade conditions met." });
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

  // Pins the cross-component contract: ThreadDock renders the first gap via
  // summary.split(" · ")[0], so the separator must stay exactly " · ".
  it("joins multiple gaps with ' · ' (the separator ThreadDock splits on)", () => {
    const r = threadReadiness({ ...base, document_links: [], status: "NEEDS_EVIDENCE" });
    expect(r.ready).toBe(false);
    expect(r.summary).toContain(" · ");
    expect(r.summary.split(" · ")[0]).toBe("No cited sources");
    expect(r.summary.split(" · ")).toContain("Not yet substantiated");
  });
});
