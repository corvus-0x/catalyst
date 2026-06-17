import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CaseWorkspaceProvider } from "../context/CaseWorkspaceContext";
import { useFeederActions, type FeederActions } from "./useFeederActions";

const createAngleMock = vi.fn();
const fetchAngleMock = vi.fn();
const updateAngleMock = vi.fn();
const toastMock = vi.fn();

vi.mock("../api", () => ({
  createAngle: (...a: unknown[]) => createAngleMock(...a),
  fetchAngle: (...a: unknown[]) => fetchAngleMock(...a),
  updateAngle: (...a: unknown[]) => updateAngleMock(...a),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(
    (...a: unknown[]) => toastMock(...a),
    { error: (...a: unknown[]) => toastMock(...a) }
  ),
}));

function Harness({ grab }: { grab: (f: FeederActions) => void }) {
  const actions = useFeederActions("c1");
  grab(actions);
  return <span data-testid="picker">{actions.pickerOpen ? "open" : "closed"}</span>;
}
function renderHarness(grab: (f: FeederActions) => void) {
  return render(
    <CaseWorkspaceProvider>
      <Harness grab={grab} />
    </CaseWorkspaceProvider>
  );
}

beforeEach(() => {
  createAngleMock.mockReset().mockResolvedValue({ id: "new-1", title: "Seed title", narrative: "" });
  fetchAngleMock.mockReset().mockResolvedValue({ id: "ang-1", title: "Existing", narrative: "old" });
  updateAngleMock.mockReset().mockResolvedValue({ id: "ang-1", title: "Existing", narrative: "updated" });
  toastMock.mockReset();
});

describe("useFeederActions", () => {
  it("startAngleFrom creates an angle WITH severity MEDIUM and returns it", async () => {
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    let result: unknown;
    await act(async () => { result = await api.startAngleFrom({ title: "Seed title" }); });
    expect(createAngleMock).toHaveBeenCalledWith("c1", { title: "Seed title", severity: "MEDIUM" });
    expect(result).toEqual({ id: "new-1", title: "Seed title" });
  });

  it("citeToAngle opens the picker when no angle is active", async () => {
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    await act(async () => { await api.citeToAngle({ label: "a fact" }); });
    expect(screen.getByTestId("picker")).toHaveTextContent("open");
    expect(updateAngleMock).not.toHaveBeenCalled();
  });

  it("picking an existing angle appends a narrative citation (no documentId)", async () => {
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    await act(async () => { await api.citeToAngle({ label: "a fact" }); });
    await act(async () => { await api.onPickerPick("ang-1"); });
    expect(fetchAngleMock).toHaveBeenCalledWith("c1", "ang-1");
    expect(updateAngleMock).toHaveBeenCalledWith("c1", "ang-1", { narrative: "old\n\n[Cited: a fact]" });
  });

  it("picking new creates an angle seeded from the item label", async () => {
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    await act(async () => { await api.citeToAngle({ label: "a fact" }); });
    await act(async () => { await api.onPickerPick(null); });
    expect(createAngleMock).toHaveBeenCalledWith("c1", { title: "a fact", severity: "MEDIUM" });
  });

  it("citing an item WITH a documentId creates a real FindingDocument citation", async () => {
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    // First set an active angle by picking an existing one.
    await act(async () => { await api.citeToAngle({ label: "seed" }); });
    await act(async () => { await api.onPickerPick("ang-1"); });
    updateAngleMock.mockClear();
    // Now the active angle is ang-1; cite a document into it.
    await act(async () => { await api.citeToAngle({ label: "Deed 2019", documentId: "doc-7" }); });
    // Document cite sends ONLY add_document_ids (atomic, no narrative clobber — review #3).
    expect(updateAngleMock).toHaveBeenCalledWith("c1", "ang-1", { add_document_ids: ["doc-7"] });
  });

  it("onPickerPick returns false and keeps the picker open when the API fails", async () => {
    createAngleMock.mockRejectedValueOnce(new Error("boom"));
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    await act(async () => { await api.citeToAngle({ label: "a fact" }); }); // no active → picker opens
    let ok: boolean | undefined;
    await act(async () => { ok = await api.onPickerPick(null); }); // create fails
    expect(ok).toBe(false);
    expect(screen.getByTestId("picker")).toHaveTextContent("open");
  });

  it("creates only ONE angle when the follow-on citation fails (review round 3 #2)", async () => {
    updateAngleMock.mockRejectedValueOnce(new Error("cite boom"));
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    await act(async () => { await api.citeToAngle({ label: "a fact" }); }); // no active → picker opens
    let ok: boolean | undefined;
    await act(async () => { ok = await api.onPickerPick(null); }); // create ok, cite fails
    // The pick "succeeds" (angle exists) so the picker can close; a retry will
    // cite into the now-active angle, never creating a second one.
    expect(createAngleMock).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });
});
