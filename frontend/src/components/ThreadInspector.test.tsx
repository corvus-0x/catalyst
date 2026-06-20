import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";

const DOC_LINK = { document_id: "d1", document_filename: "exhibit.pdf", page_reference: "p. 1", context_note: "" };
const DOC_LINK_2 = { document_id: "d2", document_filename: "exhibit2.pdf", page_reference: "p. 2", context_note: "" };

// vi.mock is hoisted — BASE_THREAD must be defined inline here, NOT referencing outer vars.
vi.mock("../api", () => ({
  fetchAngle: vi.fn().mockResolvedValue({
    id: "t1",
    title: "Insider swap",
    status: "NEEDS_EVIDENCE",
    severity: "HIGH",
    narrative: "",
    evidence_weight: "SPECULATIVE",
    overreach_reviewed: false,
    document_links: [
      { document_id: "d1", document_filename: "exhibit.pdf", page_reference: "p. 1", context_note: "" },
      { document_id: "d2", document_filename: "exhibit2.pdf", page_reference: "p. 2", context_note: "" },
    ],
  }),
  updateAngle: vi.fn().mockResolvedValue({}),
}));
import * as api from "../api";
import ThreadInspector from "./ThreadInspector";

// Shared base for per-test overrides (defined AFTER the hoisted mock block)
const BASE_THREAD = {
  id: "t1",
  title: "Insider swap",
  status: "NEEDS_EVIDENCE" as const,
  severity: "HIGH" as const,
  narrative: "",
  evidence_weight: "SPECULATIVE" as const,
  overreach_reviewed: false,
  document_links: [DOC_LINK, DOC_LINK_2],
};

beforeEach(() => vi.clearAllMocks());

describe("ThreadInspector", () => {
  it("fetches the thread and shows status/severity + cited source count", async () => {
    const { findByText } = render(
      <ThreadInspector
        caseId="c1"
        threadId="t1"
        onOpenThread={() => {}}
        onClear={() => {}}
        onChanged={() => {}}
      />,
    );
    expect(await findByText("Insider swap")).toBeTruthy();
    expect(await findByText(/2 cited sources/)).toBeTruthy();
    expect(api.fetchAngle).toHaveBeenCalledWith("c1", "t1");
  });

  it("Set aside calls updateAngle status DISMISSED (un-gated)", async () => {
    const onChanged = vi.fn();
    const { findByText, getByText } = render(
      <ThreadInspector
        caseId="c1"
        threadId="t1"
        onOpenThread={() => {}}
        onClear={() => {}}
        onChanged={onChanged}
      />,
    );
    await findByText("Insider swap");
    fireEvent.click(getByText("Set aside"));
    await waitFor(() =>
      expect(api.updateAngle).toHaveBeenCalledWith("c1", "t1", { status: "DISMISSED" }),
    );
  });

  it("status badge updates to Set Aside after successful set-aside", async () => {
    // After set-aside, the inspector re-fetches the thread. The second fetchAngle call
    // (triggered inside handleSetAside) should return a DISMISSED thread so the badge
    // shows "Set Aside" without needing a parent-driven remount.
    (vi.mocked(api.fetchAngle) as MockInstance)
      .mockResolvedValueOnce({ ...BASE_THREAD, status: "NEEDS_EVIDENCE" })  // initial load
      .mockResolvedValueOnce({ ...BASE_THREAD, status: "DISMISSED" });      // re-fetch after set-aside

    const onChanged = vi.fn();
    const { findByText, getByText } = render(
      <ThreadInspector
        caseId="c1"
        threadId="t1"
        onOpenThread={() => {}}
        onClear={() => {}}
        onChanged={onChanged}
      />,
    );
    await findByText("Insider swap");
    fireEvent.click(getByText("Set aside"));
    // After the re-fetch resolves, the badge must show the DISMISSED label
    await waitFor(() => expect(findByText("Set Aside")).resolves.toBeTruthy());
    expect(onChanged).toHaveBeenCalled();
  });

  it("Open full Thread calls onOpenThread", async () => {
    const onOpenThread = vi.fn();
    const { findByText, getByText } = render(
      <ThreadInspector
        caseId="c1"
        threadId="t1"
        onOpenThread={onOpenThread}
        onClear={() => {}}
        onChanged={() => {}}
      />,
    );
    await findByText("Insider swap");
    fireEvent.click(getByText("Open full Thread"));
    expect(onOpenThread).toHaveBeenCalled();
  });

  it("CONFIRMED + cited but SPECULATIVE weight does NOT get the green/ready color", async () => {
    // Mock returns CONFIRMED + 1 cited source BUT evidence_weight is SPECULATIVE and
    // overreach_reviewed is false — full predicate not met, must NOT show success color.
    (vi.mocked(api.fetchAngle) as MockInstance).mockResolvedValueOnce({
      ...BASE_THREAD,
      status: "CONFIRMED",
      evidence_weight: "SPECULATIVE",
      overreach_reviewed: false,
      document_links: [DOC_LINK],
    });
    const { findByText } = render(
      <ThreadInspector
        caseId="c1"
        threadId="t1"
        onOpenThread={() => {}}
        onClear={() => {}}
        onChanged={() => {}}
      />,
    );
    await findByText("Insider swap");
    // The gap text mentions the unmet condition — confirms the non-green path
    const gapEl = await findByText(/Evidence weight below Documented/);
    // The immediate parent is the styled div — its color must NOT be the success color
    const styledDiv = gapEl.closest("div[style]");
    expect(styledDiv).toBeTruthy();
    expect(styledDiv?.getAttribute("style") ?? "").not.toContain("color-success");
  });

  it("CONFIRMED + cited + DOCUMENTED weight + overreach_reviewed gets the green/ready color", async () => {
    (vi.mocked(api.fetchAngle) as MockInstance).mockResolvedValueOnce({
      ...BASE_THREAD,
      status: "CONFIRMED",
      evidence_weight: "DOCUMENTED",
      overreach_reviewed: true,
      document_links: [DOC_LINK],
    });
    const { findByText } = render(
      <ThreadInspector
        caseId="c1"
        threadId="t1"
        onOpenThread={() => {}}
        onClear={() => {}}
        onChanged={() => {}}
      />,
    );
    await findByText("Insider swap");
    const gapEl = await findByText(/All referral-grade conditions met/);
    const styledDiv = gapEl.closest("div[style]");
    expect(styledDiv).toBeTruthy();
    expect(styledDiv?.getAttribute("style") ?? "").toContain("color-success");
  });
});
