/**
 * useWorkspaceShortcuts — Workspace keyboard shortcut layer (spec §15).
 *
 * Locks in the keybindings the workspace promises:
 *   Cmd/Ctrl+\\        — toggle bottom dock
 *   Cmd/Ctrl+1..4      — switch bottom dock tabs (1=Audit, 2=Triage, 3=Transforms, 4=Documents)
 *   Cmd/Ctrl+Shift+1..4 — toggle top-bar view panes (1=Graph, 2=990, 3=Financials, 4=Package)
 *   Cmd/Ctrl+L         — toggle layout lock
 *   V / S / L          — switch graph mode (Pan / Select / Link). Letter keys are
 *                        gated against text inputs so typing in fields is unaffected.
 *   ?                  — show keyboard help overlay
 *   Esc                — fire onEscape (optional; if not provided, we fall through
 *                        to native handlers so Radix dialogs continue to close)
 *
 * Cmd/Ctrl+K (the global command palette) is intentionally NOT handled here —
 * the command-palette agent owns that binding.
 *
 * Hold-Space pan-mode for the graph is also out of scope: that's a graph-local
 * gesture, not a workspace-global shortcut, and lives inside the graph component.
 */
import { useEffect } from "react";
import { tinykeys } from "tinykeys";

export type DockTab = "audit" | "triage" | "transforms" | "documents";
export type ViewPane = "graph" | "990" | "financials" | "package";
export type GraphMode = "pan" | "select" | "link";

export interface WorkspaceShortcutHandlers {
    onToggleBottomDock: () => void;
    onSelectDockTab: (tab: DockTab) => void;
    onToggleViewPane: (view: ViewPane) => void;
    onToggleLayoutLock: () => void;
    onSetGraphMode?: (mode: GraphMode) => void;
    onShowHelp: () => void;
    onEscape?: () => void;
}

const DOCK_TAB_BY_INDEX: Record<string, DockTab> = {
    "1": "audit",
    "2": "triage",
    "3": "transforms",
    "4": "documents",
};

const VIEW_PANE_BY_INDEX: Record<string, ViewPane> = {
    "1": "graph",
    "2": "990",
    "3": "financials",
    "4": "package",
};

/**
 * True when the keyboard event was fired into a real text-input surface
 * (input, textarea, or contenteditable). Plain-letter shortcuts must skip
 * those targets so the user can type the letter "v" or "l" in a notes field.
 */
export function isTextInput(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    // `isContentEditable` is the canonical browser flag; in jsdom it isn't
    // populated, so we also consult the underlying property and attribute
    // that the spec uses to drive it.
    if (target.isContentEditable === true) return true;
    if (target.contentEditable === "true" || target.contentEditable === "plaintext-only") {
        return true;
    }
    const attr = target.getAttribute("contenteditable");
    return attr !== null && attr !== "false" && attr !== "inherit";
}

export function useWorkspaceShortcuts(handlers: WorkspaceShortcutHandlers): void {
    const {
        onToggleBottomDock,
        onSelectDockTab,
        onToggleViewPane,
        onToggleLayoutLock,
        onSetGraphMode,
        onShowHelp,
        onEscape,
    } = handlers;

    useEffect(() => {
        const bindings: Record<string, (event: KeyboardEvent) => void> = {
            // Bottom dock — toggle visibility
            "$mod+\\": (e) => {
                e.preventDefault();
                onToggleBottomDock();
            },
            // Bottom dock — tab selection (1..4)
            "$mod+Digit1": (e) => {
                e.preventDefault();
                onSelectDockTab(DOCK_TAB_BY_INDEX["1"]);
            },
            "$mod+Digit2": (e) => {
                e.preventDefault();
                onSelectDockTab(DOCK_TAB_BY_INDEX["2"]);
            },
            "$mod+Digit3": (e) => {
                e.preventDefault();
                onSelectDockTab(DOCK_TAB_BY_INDEX["3"]);
            },
            "$mod+Digit4": (e) => {
                e.preventDefault();
                onSelectDockTab(DOCK_TAB_BY_INDEX["4"]);
            },
            // Top-bar view panes — toggle (Shift+1..4)
            "$mod+Shift+Digit1": (e) => {
                e.preventDefault();
                onToggleViewPane(VIEW_PANE_BY_INDEX["1"]);
            },
            "$mod+Shift+Digit2": (e) => {
                e.preventDefault();
                onToggleViewPane(VIEW_PANE_BY_INDEX["2"]);
            },
            "$mod+Shift+Digit3": (e) => {
                e.preventDefault();
                onToggleViewPane(VIEW_PANE_BY_INDEX["3"]);
            },
            "$mod+Shift+Digit4": (e) => {
                e.preventDefault();
                onToggleViewPane(VIEW_PANE_BY_INDEX["4"]);
            },
            // Layout lock
            "$mod+KeyL": (e) => {
                e.preventDefault();
                onToggleLayoutLock();
            },
            // Help overlay — Shift+/ on US layouts produces "?"
            "Shift+Slash": (e) => {
                if (isTextInput(e.target)) return;
                e.preventDefault();
                onShowHelp();
            },
            // Graph mode — plain letter keys, gated against text inputs.
            // We register them only when a target callback is present so we
            // never swallow keypresses the parent doesn't want.
            ...(onSetGraphMode
                ? {
                    "KeyV": (e: KeyboardEvent) => {
                        if (isTextInput(e.target)) return;
                        if (e.metaKey || e.ctrlKey || e.altKey) return;
                        e.preventDefault();
                        onSetGraphMode("pan");
                    },
                    "KeyS": (e: KeyboardEvent) => {
                        if (isTextInput(e.target)) return;
                        if (e.metaKey || e.ctrlKey || e.altKey) return;
                        e.preventDefault();
                        onSetGraphMode("select");
                    },
                    // Bare "L" — distinct from Cmd/Ctrl+L (handled above with $mod).
                    // tinykeys evaluates the most-specific match first, so an
                    // unmodified L lands here and a modified L lands on $mod+KeyL.
                    "KeyL": (e: KeyboardEvent) => {
                        if (isTextInput(e.target)) return;
                        if (e.metaKey || e.ctrlKey || e.altKey) return;
                        e.preventDefault();
                        onSetGraphMode("link");
                    },
                }
                : {}),
            // Esc — only intercept if the parent supplied a handler. Otherwise
            // we leave it alone so Radix dialogs / popovers can close natively.
            ...(onEscape
                ? {
                    "Escape": (e: KeyboardEvent) => {
                        onEscape();
                        // Don't preventDefault — parent may want native behavior too.
                        void e;
                    },
                }
                : {}),
        };

        return tinykeys(window, bindings);
    }, [
        onToggleBottomDock,
        onSelectDockTab,
        onToggleViewPane,
        onToggleLayoutLock,
        onSetGraphMode,
        onShowHelp,
        onEscape,
    ]);
}
