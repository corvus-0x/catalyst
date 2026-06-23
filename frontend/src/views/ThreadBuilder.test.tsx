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
import { render, screen, waitFor } from "@testing-library/react";
import ThreadBuilder from "./ThreadBuilder";
import * as api from "../api";

vi.mock("../api");

const thread = {
  id: "f1", rule_id: "MANUAL", title: "Insider deal", status: "ACTIVE",
  evidence_weight: "DOCUMENTED", overreach_reviewed: false, gate_version: "ASSERTION_V1",
  document_links: [], entity_links: [], elements: [
    { id: "e1", finding_id: "f1", element_type: "ASSERTION", role: "analysis",
      text: "Payment to LLC", position: 0, handoff_ready: false, citations: [] },
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
});
