import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CaseWorkspaceProvider, useCaseWorkspace } from "../context/CaseWorkspaceContext";
import { useFeederActions, type FeederActions } from "./useFeederActions";
import { renderHook } from "@testing-library/react";

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

describe("useFeederActions migration to activateThread", () => {
  it("startAngleFrom makes the new angle the active cite target WITHOUT pushing history", async () => {
    function useBoth() {
      return { feeder: useFeederActions("c1"), ws: useCaseWorkspace() };
    }
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CaseWorkspaceProvider>{children}</CaseWorkspaceProvider>
    );
    vi.mocked(createAngleMock).mockResolvedValue({ id: "a1", title: "New" });
    vi.mocked(fetchAngleMock).mockResolvedValue({ id: "a1", title: "New", narrative: "", document_links: [] });
    const { result } = renderHook(useBoth, { wrapper });
    await act(async () => { await result.current.feeder.startAngleFrom({ title: "T" }); });
    expect(result.current.ws.activeAngleId).toBe("a1");
    expect(result.current.ws.history).toHaveLength(1); // no frame pushed
    expect(result.current.ws.selection).toEqual({ kind: "none" });
  });
});

describe("useFeederActions", () => {
  it("startAngleFrom creates an angle WITH severity MEDIUM and returns it", async () => {
    let feederApi: FeederActions = null as never;
    renderHarness((f) => (feederApi = f));
    let result: unknown;
    await act(async () => { result = await feederApi.startAngleFrom({ title: "Seed title" }); });
    expect(createAngleMock).toHaveBeenCalledWith("c1", { title: "Seed title", severity: "MEDIUM" });
    expect(result).toEqual({ id: "new-1", title: "Seed title" });
  });

  it("citeToAngle opens the picker when no angle is active", async () => {
    let feederApi: FeederActions = null as never;
    renderHarness((f) => (feederApi = f));
    await act(async () => { await feederApi.citeToAngle({ label: "a fact" }); });
    expect(screen.getByTestId("picker")).toHaveTextContent("open");
    expect(updateAngleMock).not.toHaveBeenCalled();
  });

  it("picking an existing angle appends a narrative citation (no documentId)", async () => {
    let feederApi: FeederActions = null as never;
    renderHarness((f) => (feederApi = f));
    await act(async () => { await feederApi.citeToAngle({ label: "a fact" }); });
    await act(async () => { await feederApi.onPickerPick("ang-1"); });
    expect(fetchAngleMock).toHaveBeenCalledWith("c1", "ang-1");
    expect(updateAngleMock).toHaveBeenCalledWith("c1", "ang-1", { narrative: "old\n\n[Cited: a fact]" });
  });

  it("picking new creates an angle seeded from the item label", async () => {
    let feederApi: FeederActions = null as never;
    renderHarness((f) => (feederApi = f));
    await act(async () => { await feederApi.citeToAngle({ label: "a fact" }); });
    await act(async () => { await feederApi.onPickerPick(null); });
    expect(createAngleMock).toHaveBeenCalledWith("c1", { title: "a fact", severity: "MEDIUM" });
  });

  it("citing an item WITH a documentId creates a real FindingDocument citation", async () => {
    let feederApi: FeederActions = null as never;
    renderHarness((f) => (feederApi = f));
    // First set an active angle by picking an existing one.
    await act(async () => { await feederApi.citeToAngle({ label: "seed" }); });
    await act(async () => { await feederApi.onPickerPick("ang-1"); });
    updateAngleMock.mockClear();
    // Now the active angle is ang-1; cite a document into it.
    await act(async () => { await feederApi.citeToAngle({ label: "Deed 2019", documentId: "doc-7" }); });
    // Document cite sends ONLY add_document_ids (atomic, no narrative clobber).
    expect(updateAngleMock).toHaveBeenCalledWith("c1", "ang-1", { add_document_ids: ["doc-7"] });
  });

  it("onPickerPick returns false and keeps the picker open when the API fails", async () => {
    createAngleMock.mockRejectedValueOnce(new Error("boom"));
    let feederApi: FeederActions = null as never;
    renderHarness((f) => (feederApi = f));
    await act(async () => { await feederApi.citeToAngle({ label: "a fact" }); }); // no active → picker opens
    let ok: boolean | undefined;
    await act(async () => { ok = await feederApi.onPickerPick(null); }); // create fails
    expect(ok).toBe(false);
    expect(screen.getByTestId("picker")).toHaveTextContent("open");
  });

  it("creates only ONE angle when the follow-on citation fails", async () => {
    updateAngleMock.mockRejectedValueOnce(new Error("cite boom"));
    let feederApi: FeederActions = null as never;
    renderHarness((f) => (feederApi = f));
    await act(async () => { await feederApi.citeToAngle({ label: "a fact" }); }); // no active → picker opens
    let ok: boolean | undefined;
    await act(async () => { ok = await feederApi.onPickerPick(null); }); // create ok, cite fails
    // The pick "succeeds" (angle exists) so the picker can close; a retry will
    // cite into the now-active angle, never creating a second one.
    expect(createAngleMock).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it("a retry after a partial-failure cite reuses the active angle (no second create)", async () => {
    updateAngleMock.mockRejectedValueOnce(new Error("cite boom")); // first cite fails
    let feederApi: FeederActions = null as never;
    renderHarness((f) => (feederApi = f));
    await act(async () => { await feederApi.citeToAngle({ label: "a fact" }); }); // picker opens
    await act(async () => { await feederApi.onPickerPick(null); }); // create ok, cite fails → new-1 active
    // Retry: the angle is already active, so this goes straight to applyCite —
    // it must NOT create a second angle, and must cite into the existing one.
    await act(async () => { await feederApi.citeToAngle({ label: "a fact" }); });
    expect(createAngleMock).toHaveBeenCalledTimes(1);
    expect(updateAngleMock).toHaveBeenLastCalledWith("c1", "new-1", { narrative: "old\n\n[Cited: a fact]" });
  });

  it("toasts 'Already cited' when the document is already linked, else 'Cited document into'", async () => {
    let feederApi: FeederActions = null as never;
    renderHarness((f) => (feederApi = f));
    await act(async () => { await feederApi.citeToAngle({ label: "seed" }); });
    await act(async () => { await feederApi.onPickerPick("ang-1"); }); // activate ang-1
    toastMock.mockClear();
    // Document not yet linked → "Cited document into".
    fetchAngleMock.mockResolvedValueOnce({ id: "ang-1", title: "Existing", narrative: "old", document_links: [] });
    await act(async () => { await feederApi.citeToAngle({ label: "Deed", documentId: "doc-7" }); });
    expect(toastMock).toHaveBeenLastCalledWith('Cited document into "Existing".');
    // Same document already linked → "Already cited".
    fetchAngleMock.mockResolvedValueOnce({
      id: "ang-1",
      title: "Existing",
      narrative: "old",
      document_links: [{ document_id: "doc-7" }],
    });
    await act(async () => { await feederApi.citeToAngle({ label: "Deed", documentId: "doc-7" }); });
    expect(toastMock).toHaveBeenLastCalledWith('Already cited in "Existing".');
  });
});
