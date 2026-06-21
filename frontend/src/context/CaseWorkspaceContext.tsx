// context/CaseWorkspaceContext.tsx
import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";

/** Subjects are persons or organizations — the only entity types that appear as
 * Case Map nodes and can be opened in a full profile frame. */
export type SubjectEntityType = "person" | "organization";

export type Frame =
  | { kind: "web" }
  | { kind: "profile"; id: string; entityType: SubjectEntityType; name: string }
  | { kind: "angle"; id: string; title: string }
  | { kind: "document"; id: string; name: string };

export type Selection =
  | { kind: "none" }
  | { kind: "subject"; id: string }
  | { kind: "relationship"; edgeId: string }
  | { kind: "thread"; id: string };

interface FocusState {
  history: Frame[];
  selection: Selection;
  activeEntityId: string | undefined;
  activeAngleId: string | undefined;
  activeAngleTitle: string | undefined;
}

type Action =
  | { type: "selectSubject"; id: string }
  | { type: "selectRelationship"; edgeId: string }
  | { type: "selectThread"; id: string; title: string }
  | { type: "activateThread"; id: string; title: string }
  | { type: "clearSelection" }
  | { type: "openProfile"; id: string; entityType: SubjectEntityType; name: string }
  | { type: "openThread"; id: string; title: string }
  | { type: "openDocument"; id: string; name: string }
  | { type: "goBack" }
  | { type: "goTo"; index: number }
  | { type: "clearActiveAngle" };

const INITIAL: FocusState = {
  history: [{ kind: "web" }],
  selection: { kind: "none" },
  activeEntityId: undefined,
  activeAngleId: undefined,
  activeAngleTitle: undefined,
};

const NONE: Selection = { kind: "none" };

/** nearest matching frame scanning most-recent to oldest (the §3.3 invariant). */
function recompute(history: Frame[]) {
  let activeEntityId: string | undefined;
  let activeAngleId: string | undefined;
  let activeAngleTitle: string | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const f = history[i];
    if (activeAngleId === undefined && f.kind === "angle") {
      activeAngleId = f.id;
      activeAngleTitle = f.title;
    }
    if (activeEntityId === undefined && f.kind === "profile") {
      activeEntityId = f.id;
    }
  }
  return { activeEntityId, activeAngleId, activeAngleTitle };
}

function sameTop(history: Frame[], frame: Frame): boolean {
  const top = history[history.length - 1];
  if (top.kind !== frame.kind) return false;
  if (top.kind === "web" || frame.kind === "web") return top.kind === frame.kind;
  return (top as { id: string }).id === (frame as { id: string }).id;
}

function pushDedup(history: Frame[], frame: Frame): Frame[] {
  return sameTop(history, frame) ? history : [...history, frame];
}

function reducer(state: FocusState, action: Action): FocusState {
  switch (action.type) {
    case "selectSubject":
      return { ...state, selection: { kind: "subject", id: action.id }, activeEntityId: action.id };
    case "selectRelationship":
      return { ...state, selection: { kind: "relationship", edgeId: action.edgeId } };
    case "selectThread":
      return {
        ...state,
        selection: { kind: "thread", id: action.id },
        activeAngleId: action.id,
        activeAngleTitle: action.title,
      };
    case "activateThread":
      return { ...state, activeAngleId: action.id, activeAngleTitle: action.title };
    case "clearSelection":
      return { ...state, selection: NONE };
    case "openProfile": {
      const history = pushDedup(state.history, {
        kind: "profile", id: action.id, entityType: action.entityType, name: action.name,
      });
      return { ...state, history, selection: NONE, activeEntityId: action.id };
    }
    case "openThread": {
      const history = pushDedup(state.history, { kind: "angle", id: action.id, title: action.title });
      return { ...state, history, selection: NONE, activeAngleId: action.id, activeAngleTitle: action.title };
    }
    case "openDocument": {
      const history = pushDedup(state.history, { kind: "document", id: action.id, name: action.name });
      return { ...state, history, selection: NONE }; // pointers unchanged (cite-into-thread)
    }
    case "goBack": {
      if (state.history.length <= 1) return { ...state, selection: NONE };
      const history = state.history.slice(0, -1);
      return { ...state, history, selection: NONE, ...recompute(history) };
    }
    case "goTo": {
      const history = state.history.slice(0, Math.max(0, action.index) + 1);
      return { ...state, history, selection: NONE, ...recompute(history) };
    }
    case "clearActiveAngle":
      return { ...state, activeAngleId: undefined, activeAngleTitle: undefined };
    default:
      return state;
  }
}

export interface CaseWorkspaceState {
  currentFrame: Frame;
  history: Frame[];
  selection: Selection;
  activeEntityId: string | undefined;
  activeAngleId: string | undefined;
  activeAngleTitle: string | undefined;
  selectSubject: (id: string) => void;
  selectRelationship: (edgeId: string) => void;
  selectThread: (id: string, title: string) => void;
  activateThread: (a: { id: string; title: string }) => void;
  clearSelection: () => void;
  openProfile: (e: { id: string; entityType: SubjectEntityType; name: string }) => void;
  openThread: (a: { id: string; title: string }) => void;
  openDocument: (d: { id: string; name: string }) => void;
  goBack: () => void;
  goTo: (index: number) => void;
  clearActiveAngle: () => void;
}

const CaseWorkspaceContext = createContext<CaseWorkspaceState | null>(null);

export function CaseWorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const value = useMemo<CaseWorkspaceState>(
    () => ({
      currentFrame: state.history[state.history.length - 1],
      history: state.history,
      selection: state.selection,
      activeEntityId: state.activeEntityId,
      activeAngleId: state.activeAngleId,
      activeAngleTitle: state.activeAngleTitle,
      selectSubject: (id) => dispatch({ type: "selectSubject", id }),
      selectRelationship: (edgeId) => dispatch({ type: "selectRelationship", edgeId }),
      selectThread: (id, title) => dispatch({ type: "selectThread", id, title }),
      activateThread: (a) => dispatch({ type: "activateThread", id: a.id, title: a.title }),
      clearSelection: () => dispatch({ type: "clearSelection" }),
      openProfile: (e) => dispatch({ type: "openProfile", ...e }),
      openThread: (a) => dispatch({ type: "openThread", ...a }),
      openDocument: (d) => dispatch({ type: "openDocument", ...d }),
      goBack: () => dispatch({ type: "goBack" }),
      goTo: (index) => dispatch({ type: "goTo", index }),
      clearActiveAngle: () => dispatch({ type: "clearActiveAngle" }),
    }),
    [state]
  );
  return <CaseWorkspaceContext.Provider value={value}>{children}</CaseWorkspaceContext.Provider>;
}

export function useCaseWorkspace(): CaseWorkspaceState {
  const ctx = useContext(CaseWorkspaceContext);
  if (!ctx) throw new Error("useCaseWorkspace must be used within a CaseWorkspaceProvider");
  return ctx;
}
