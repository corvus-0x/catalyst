import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({
  fetchAngle: vi.fn().mockResolvedValue({
    id: "t1",
    title: "Insider swap",
    status: "NEEDS_EVIDENCE",
    severity: "HIGH",
    narrative: "",
    document_links: [{ document_id: "d1" }, { document_id: "d2" }],
  }),
  updateAngle: vi.fn().mockResolvedValue({}),
}));
import * as api from "../api";
import ThreadInspector from "./ThreadInspector";
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
});
