import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface ActiveAngle {
  id: string;
  title: string;
}

export interface CaseWorkspaceState {
  /** Currently selected knot/entity (set by Web knot click; more producers in build item 3). */
  activeEntityId: string | undefined;
  /** Currently open Angle — feeder "Cite" actions target this. */
  activeAngleId: string | undefined;
  activeAngleTitle: string | undefined;
  setActiveEntity: (id: string | undefined) => void;
  setActiveAngle: (angle: ActiveAngle | undefined) => void;
}

const CaseWorkspaceContext = createContext<CaseWorkspaceState | null>(null);

export function CaseWorkspaceProvider({ children }: { children: ReactNode }) {
  const [activeEntityId, setActiveEntity] = useState<string | undefined>();
  const [activeAngle, setActiveAngle] = useState<ActiveAngle | undefined>();

  const value = useMemo<CaseWorkspaceState>(
    () => ({
      activeEntityId,
      activeAngleId: activeAngle?.id,
      activeAngleTitle: activeAngle?.title,
      setActiveEntity,
      setActiveAngle,
    }),
    [activeEntityId, activeAngle]
  );

  return (
    <CaseWorkspaceContext.Provider value={value}>
      {children}
    </CaseWorkspaceContext.Provider>
  );
}

export function useCaseWorkspace(): CaseWorkspaceState {
  const ctx = useContext(CaseWorkspaceContext);
  if (!ctx) {
    throw new Error("useCaseWorkspace must be used within a CaseWorkspaceProvider");
  }
  return ctx;
}
