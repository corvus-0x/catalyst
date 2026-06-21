// context/CaseWorkspaceContext.test.tsx
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CaseWorkspaceProvider, useCaseWorkspace } from "./CaseWorkspaceContext";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CaseWorkspaceProvider>{children}</CaseWorkspaceProvider>
);
const setup = () => renderHook(() => useCaseWorkspace(), { wrapper });

describe("focus reducer", () => {
  it("defaults to web frame, no selection, no pointers", () => {
    const { result } = setup();
    expect(result.current.currentFrame).toEqual({ kind: "web" });
    expect(result.current.selection).toEqual({ kind: "none" });
    expect(result.current.activeAngleId).toBeUndefined();
  });

  it("selectSubject sets selection + entity pointer but NEVER pushes history", () => {
    const { result } = setup();
    act(() => result.current.selectSubject("p1"));
    expect(result.current.selection).toEqual({ kind: "subject", id: "p1" });
    expect(result.current.activeEntityId).toBe("p1");
    expect(result.current.history).toHaveLength(1); // still [web]
  });

  it("selectRelationship sets selection only, no history, no pointer change", () => {
    const { result } = setup();
    act(() => result.current.selectThread("a1", "T")); // pointer set
    act(() => result.current.selectRelationship("p1__p2"));
    expect(result.current.selection).toEqual({ kind: "relationship", edgeId: "p1__p2" });
    expect(result.current.history).toHaveLength(1);
    expect(result.current.activeAngleId).toBe("a1"); // unchanged by selectRelationship
  });

  it("selectThread sets selection + angle pointer (map-mode cite target)", () => {
    const { result } = setup();
    act(() => result.current.selectThread("a1", "Self-dealing"));
    expect(result.current.selection).toEqual({ kind: "thread", id: "a1" });
    expect(result.current.activeAngleId).toBe("a1");
    expect(result.current.activeAngleTitle).toBe("Self-dealing");
    expect(result.current.history).toHaveLength(1);
  });

  it("activateThread sets the pointer WITHOUT mutating selection or history", () => {
    const { result } = setup();
    act(() => result.current.selectSubject("p1"));
    act(() => result.current.activateThread({ id: "a9", title: "From feeder" }));
    expect(result.current.activeAngleId).toBe("a9");
    expect(result.current.selection).toEqual({ kind: "subject", id: "p1" }); // unchanged
    expect(result.current.history).toHaveLength(1); // unchanged
  });

  it("openThread pushes an angle frame, clears selection, sets pointer", () => {
    const { result } = setup();
    act(() => result.current.selectSubject("p1"));
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    expect(result.current.currentFrame).toEqual({ kind: "angle", id: "a1", title: "T" });
    expect(result.current.history).toHaveLength(2);
    expect(result.current.selection).toEqual({ kind: "none" });
    expect(result.current.activeAngleId).toBe("a1");
  });

  it("open* dedups when the top frame already matches", () => {
    const { result } = setup();
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    expect(result.current.history).toHaveLength(2); // not 3
  });

  it("openDocument preserves the active thread (cite-into-thread invariant)", () => {
    const { result } = setup();
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    act(() => result.current.openDocument({ id: "d1", name: "Deed" }));
    expect(result.current.currentFrame).toEqual({ kind: "document", id: "d1", name: "Deed" });
    expect(result.current.activeAngleId).toBe("a1"); // still active
  });

  it("goBack recomputes pointers: doc-opened-from-thread, go back, thread still active", () => {
    const { result } = setup();
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    act(() => result.current.openDocument({ id: "d1", name: "Deed" }));
    act(() => result.current.goBack());
    expect(result.current.currentFrame).toEqual({ kind: "angle", id: "a1", title: "T" });
    expect(result.current.activeAngleId).toBe("a1");
  });

  it("goTo truncates and recomputes (back to web clears the angle pointer)", () => {
    const { result } = setup();
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    act(() => result.current.goTo(0));
    expect(result.current.currentFrame).toEqual({ kind: "web" });
    expect(result.current.activeAngleId).toBeUndefined();
  });

  it("clearActiveAngle nulls the pointer without touching history", () => {
    const { result } = setup();
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    act(() => result.current.clearActiveAngle());
    expect(result.current.activeAngleId).toBeUndefined();
    expect(result.current.history).toHaveLength(2); // unchanged
  });

  it("throws outside a provider", () => {
    expect(() => renderHook(() => useCaseWorkspace())).toThrow(/CaseWorkspaceProvider/);
  });
});
