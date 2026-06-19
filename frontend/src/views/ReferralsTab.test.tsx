/**
 * ReferralsTab.test.tsx
 *
 * Tests for ReferralsTab focusing on readiness-aware export gating:
 *   1. PDF button must be disabled when readiness is null (load failed).
 *   2. A 400 export response whose body carries a `readiness` field must
 *      refresh the readiness panel and display an explanatory error.
 *
 * Mocking strategy: vi.mock("../api") — same pattern as AngleView.test.tsx.
 * We mock getReferralTargets, fetchReferralReadiness, generateReferralPdf,
 * and sonner toast.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReferralsTab from "./ReferralsTab";

// ---------------------------------------------------------------------------
// Mock the entire api module
// ---------------------------------------------------------------------------

vi.mock("../api", () => ({
  getReferralTargets: vi.fn(),
  fetchReferralReadiness: vi.fn(),
  generateReferralPdf: vi.fn(),
  createReferralTarget: vi.fn(),
  updateReferralTarget: vi.fn(),
  deleteReferralTarget: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.body = body;
    }
  },
}));

// ---------------------------------------------------------------------------
// Sonner toast — no-op so no portal setup needed
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Imports for mocked functions (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import * as api from "../api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const emptyTargetsResponse = { count: 0, next: null, previous: null, results: [] };

const readyReadiness = {
  status: "READY" as const,
  summary: "All checks passed.",
  items: [],
  quality: { score: 85, status: "READY" as const, grade: "Strong" as const, top_issues: [] },
};

const blockedReadiness = {
  status: "BLOCKED" as const,
  summary: "1 blocker",
  items: [],
  quality: { score: 10, status: "BLOCKED" as const, grade: "Blocked" as const, top_issues: [] },
};

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: targets list resolves empty
  vi.mocked(api.getReferralTargets).mockResolvedValue(emptyTargetsResponse);
  // Default: readiness resolves READY
  vi.mocked(api.fetchReferralReadiness).mockResolvedValue(readyReadiness);
  // Default: PDF succeeds with an empty blob
  vi.mocked(api.generateReferralPdf).mockResolvedValue(new Blob());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReferralsTab — readiness-aware export gating", () => {
  it("disables PDF export when readiness is unknown (load failed)", async () => {
    // Arrange: fetchReferralReadiness rejects, so readiness stays null
    vi.mocked(api.fetchReferralReadiness).mockRejectedValue(new Error("network error"));

    render(<ReferralsTab caseId="case-1" />);

    // Wait for the loading spinner to disappear
    const btn = await screen.findByRole("button", { name: /generate referral/i });
    expect(btn).toBeDisabled();
  });

  it("refreshes the readiness panel from a 400 export body", async () => {
    // Arrange: readiness loads as READY (button enabled), then PDF export
    // returns 400 with a blocked readiness body.
    vi.mocked(api.fetchReferralReadiness).mockResolvedValue(readyReadiness);

    const err: Error & { status?: number; body?: unknown } = new Error("blocked");
    err.status = 400;
    err.body = {
      error: "blocked",
      readiness: blockedReadiness,
    };
    vi.mocked(api.generateReferralPdf).mockRejectedValue(err);

    render(<ReferralsTab caseId="case-1" />);

    // Wait for initial load to complete and button to appear
    const btn = await screen.findByRole("button", { name: /generate referral/i });
    expect(btn).not.toBeDisabled();

    // Act: click the generate button
    fireEvent.click(btn);

    // Assert: the readiness panel now shows the summary from the 400 body
    await waitFor(() =>
      expect(screen.getByText(/1 blocker/i)).toBeInTheDocument()
    );

    // Assert: an explanatory error message is shown (not the raw err.message)
    await waitFor(() =>
      expect(screen.getByText(/export blocked/i)).toBeInTheDocument()
    );
  });
});
