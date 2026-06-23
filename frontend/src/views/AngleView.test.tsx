/**
 * AngleView.test.tsx
 *
 * Tests for AngleView — specifically narrative autosave failure surfacing
 * and the tie-off button guard.
 *
 * Mocking strategy: vi.mock("../api") replaces all named exports with
 * vi.fn(). We provide controlled implementations per-test via mockResolvedValue
 * / mockRejectedValueOnce to simulate server responses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AngleView from "./AngleView";
import type { FindingItem, InvestigatorNote } from "../types";
import * as api from "../api";

// ---------------------------------------------------------------------------
// Mock the entire api module — every export becomes a vi.fn()
// ---------------------------------------------------------------------------

vi.mock("../api", () => ({
  fetchAngle: vi.fn(),
  updateAngle: vi.fn(),
  fetchNotes: vi.fn(),
  aiAsk: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  deleteAngle: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

// ---------------------------------------------------------------------------
// Sonner toast — no-op so we don't need jsdom portal setup
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Lazy-loaded modal components — stub them out so we don't need their deps
// ---------------------------------------------------------------------------

vi.mock("../components/CiteDocumentPicker", () => ({
  default: () => null,
}));
vi.mock("../components/TieOffModal", () => ({
  default: () => null,
}));
vi.mock("../components/AngleSplitModal", () => ({
  default: () => null,
}));

// ---------------------------------------------------------------------------
// Minimal FindingItem fixture
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<FindingItem> = {}): FindingItem {
  return {
    id: "angle-1",
    rule_id: "MANUAL",
    title: "Test Angle",
    description: "desc",
    narrative: "",
    severity: "MEDIUM",
    status: "NEEDS_EVIDENCE",
    evidence_weight: "SPECULATIVE",
    overreach_reviewed: false,
    source: "MANUAL",
    investigator_note: "",
    legal_refs: [],
    evidence_snapshot: {},
    trigger_doc_id: null,
    trigger_doc_filename: null,
    trigger_entity_id: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    entity_links: [],
    document_links: [],
    elements: [],
    gate_version: "ASSERTION_V1",
    ...overrides,
  };
}

const emptyNotesResponse = { count: 0, limit: 20, offset: 0, next_offset: null, previous_offset: null, results: [] as InvestigatorNote[] };

// ---------------------------------------------------------------------------
// Default prop values
// ---------------------------------------------------------------------------

const defaultProps = {
  caseId: "case-1",
  angleId: "angle-1",
  documents: [],
  onDocumentClick: vi.fn(),
  onBack: vi.fn(),
  onAngleTiedOff: vi.fn(),
};

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path: fetchNotes returns empty list
  vi.mocked(api.fetchNotes).mockResolvedValue(emptyNotesResponse);
  // Default: aiAsk never called (no docs cited in fixture)
  vi.mocked(api.aiAsk).mockResolvedValue({ answer: "" });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AngleView narrative autosave failure", () => {
  it("shows an error and blocks tie-off when narrative autosave fails", async () => {
    // Arrange: initial fetch succeeds; update fails
    vi.mocked(api.fetchAngle).mockResolvedValue(makeFinding({ narrative: "" }));
    vi.mocked(api.updateAngle).mockRejectedValueOnce(new Error("save failed"));

    render(<AngleView {...defaultProps} />);

    // Wait for the angle to load (spinner goes away, textarea appears)
    const editor = await screen.findByLabelText(/narrative/i);

    // Act: type something and blur
    fireEvent.change(editor, { target: { value: "New narrative text" } });
    fireEvent.blur(editor);

    // Assert: error message appears
    await waitFor(() =>
      expect(screen.getByText(/couldn.t save the narrative/i)).toBeInTheDocument()
    );

    // Assert: tie-off button is disabled
    expect(screen.getByRole("button", { name: /tie off/i })).toBeDisabled();
  });

  it("clears the error and re-enables tie-off after a successful retry", async () => {
    // Arrange: first update fails, second succeeds
    const savedFinding = makeFinding({ narrative: "New narrative text" });
    vi.mocked(api.fetchAngle).mockResolvedValue(makeFinding({ narrative: "" }));
    vi.mocked(api.updateAngle)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(savedFinding);

    render(<AngleView {...defaultProps} />);

    const editor = await screen.findByLabelText(/narrative/i);

    // First blur → fails
    fireEvent.change(editor, { target: { value: "New narrative text" } });
    fireEvent.blur(editor);
    await waitFor(() =>
      expect(screen.getByText(/couldn.t save the narrative/i)).toBeInTheDocument()
    );

    // Second blur → succeeds
    fireEvent.blur(editor);
    await waitFor(() =>
      expect(screen.queryByText(/couldn.t save the narrative/i)).not.toBeInTheDocument()
    );

    // Tie-off should be enabled again (narrative now matches server value)
    expect(screen.getByRole("button", { name: /tie off/i })).not.toBeDisabled();

    // The retry must actually re-issue the save (guard against a future regression
    // where the failed save silently short-circuits the second blur).
    expect(api.updateAngle).toHaveBeenCalledTimes(2);
  });

  it("tie-off is disabled while narrative is dirty (unsaved but no error)", async () => {
    vi.mocked(api.fetchAngle).mockResolvedValue(makeFinding({ narrative: "" }));
    // updateAngle hangs — simulate in-progress save, but we just check dirty state
    vi.mocked(api.updateAngle).mockImplementation(() => new Promise(() => {}));

    render(<AngleView {...defaultProps} />);

    const editor = await screen.findByLabelText(/narrative/i);

    // Tie-off starts enabled (narrative is empty === savedNarrativeRef = "")
    expect(screen.getByRole("button", { name: /tie off/i })).not.toBeDisabled();

    // Dirty the narrative (don't blur — just change so savedNarrativeRef diverges)
    fireEvent.change(editor, { target: { value: "Draft not yet saved" } });

    // Tie-off is now disabled because narrative !== savedNarrativeRef
    expect(screen.getByRole("button", { name: /tie off/i })).toBeDisabled();
  });
});
