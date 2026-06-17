import { render, screen, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  CaseWorkspaceProvider,
  useCaseWorkspace,
  type CaseWorkspaceState,
} from "./CaseWorkspaceContext";

function Probe({ grab }: { grab: (s: CaseWorkspaceState) => void }) {
  const ws = useCaseWorkspace();
  grab(ws);
  return (
    <div>
      <span data-testid="entity">{ws.activeEntityId ?? "none"}</span>
      <span data-testid="angle">{ws.activeAngleId ?? "none"}</span>
      <span data-testid="title">{ws.activeAngleTitle ?? "none"}</span>
    </div>
  );
}

describe("CaseWorkspaceContext", () => {
  it("defaults to undefined selection", () => {
    render(
      <CaseWorkspaceProvider>
        <Probe grab={() => {}} />
      </CaseWorkspaceProvider>
    );
    expect(screen.getByTestId("entity")).toHaveTextContent("none");
    expect(screen.getByTestId("angle")).toHaveTextContent("none");
  });

  it("setActiveAngle exposes id and title; setActiveEntity exposes id", () => {
    let api: CaseWorkspaceState | null = null;
    render(
      <CaseWorkspaceProvider>
        <Probe grab={(s) => (api = s)} />
      </CaseWorkspaceProvider>
    );
    act(() => api!.setActiveAngle({ id: "ang-1", title: "Self-dealing" }));
    expect(screen.getByTestId("angle")).toHaveTextContent("ang-1");
    expect(screen.getByTestId("title")).toHaveTextContent("Self-dealing");

    act(() => api!.setActiveEntity("ent-9"));
    expect(screen.getByTestId("entity")).toHaveTextContent("ent-9");

    act(() => api!.setActiveAngle(undefined));
    expect(screen.getByTestId("angle")).toHaveTextContent("none");
  });

  it("useCaseWorkspace throws outside a provider", () => {
    function Bad() {
      useCaseWorkspace();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/CaseWorkspaceProvider/);
  });
});
