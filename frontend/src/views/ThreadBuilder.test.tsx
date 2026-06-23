/**
 * ThreadBuilder.test.tsx
 *
 * Tests for ThreadBuilder — the assertion-list thread detail surface
 * that replaces AngleView as the `frame.kind === "angle"` render.
 *
 * Covers:
 *   1. Renders an ElementCard per element + shows readiness gaps for ASSERTION_V1
 *   2. Shows the convert prompt for LEGACY_NARRATIVE threads
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ThreadBuilder from "./ThreadBuilder";
import * as api from "../api";

vi.mock("../api");

const element = (over: Record<string, unknown>) => ({
  finding_id: "f1", element_type: "ASSERTION", role: "analysis",
  handoff_ready: false, citations: [], ...over,
});

const thread = {
  id: "f1", rule_id: "MANUAL", title: "Insider deal", status: "ACTIVE",
  evidence_weight: "DOCUMENTED", overreach_reviewed: false, gate_version: "ASSERTION_V1",
  document_links: [], entity_links: [], elements: [
    element({ id: "e1", text: "Payment to LLC", position: 0 }),
  ],
} as any;

const twoElementThread = {
  ...thread,
  elements: [
    element({ id: "e1", text: "First", position: 0 }),
    element({ id: "e2", text: "Second", position: 1 }),
  ],
} as any;

describe("ThreadBuilder", () => {
  beforeEach(() => {
    (api.fetchAngle as any) = vi.fn(async () => thread);
    (api.fetchNotes as any) = vi.fn(async () => ({ results: [] }));
  });

  // ThreadBuilder keeps AngleView's exact prop contract (AngleView.tsx:48):
  // caseId, angleId, documents, onDocumentClick, onBack, onAngleTiedOff.
  const props = {
    caseId: "c1", angleId: "f1", documents: [],
    onDocumentClick: vi.fn(), onBack: vi.fn(), onAngleTiedOff: vi.fn(),
  };

  it("renders an ElementCard per element and the readiness gaps", async () => {
    render(<ThreadBuilder {...props} />);
    await waitFor(() => expect(screen.getByText("Payment to LLC")).toBeInTheDocument());
    // ASSERTION_V1 with no cited/handoff assertion → readiness shows the new gaps
    expect(screen.getByText(/handoff-ready claim/i)).toBeInTheDocument();
  });

  it("shows the convert prompt for LEGACY_NARRATIVE threads", async () => {
    (api.fetchAngle as any) = vi.fn(async () => ({ ...thread, gate_version: "LEGACY_NARRATIVE" }));
    render(<ThreadBuilder {...props} />);
    await waitFor(() => expect(screen.getByText(/convert to structured assertions/i)).toBeInTheDocument());
  });

  it("reorder: moving the first element down calls reorderElements with transposed ids", async () => {
    (api.fetchAngle as any) = vi.fn(async () => twoElementThread);
    (api.reorderElements as any) = vi.fn(async () => twoElementThread.elements);
    render(<ThreadBuilder {...props} />);
    await waitFor(() => expect(screen.getByText("First")).toBeInTheDocument());
    // The first element's "Move down" should swap e1 and e2.
    fireEvent.click(screen.getAllByRole("button", { name: /move down/i })[0]);
    await waitFor(() =>
      expect(api.reorderElements).toHaveBeenCalledWith("c1", "f1", ["e2", "e1"]),
    );
  });

  it("add: clicking + Assertion calls createElement with an empty ASSERTION", async () => {
    (api.createElement as any) = vi.fn(async () => element({ id: "new", text: "" }));
    render(<ThreadBuilder {...props} />);
    await waitFor(() => expect(screen.getByText("Payment to LLC")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Assertion" }));
    await waitFor(() =>
      expect(api.createElement).toHaveBeenCalledWith("c1", "f1", {
        element_type: "ASSERTION",
        text: "",
      }),
    );
  });
});
