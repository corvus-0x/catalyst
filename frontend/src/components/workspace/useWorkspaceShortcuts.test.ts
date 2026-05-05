/**
 * useWorkspaceShortcuts tests — spec §15 keybinding lock-in.
 *
 * We dispatch real KeyboardEvent objects on `window` because tinykeys
 * registers a window-level keydown listener and inspects `event.code`,
 * `event.key`, and the modifier flags directly. userEvent.keyboard()
 * works fine for plain letters, but for chord keys (Cmd/Ctrl + digit)
 * we fire KeyboardEvent manually so we can set `code` and `metaKey`
 * exactly as a real browser would.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceShortcuts, isTextInput } from "./useWorkspaceShortcuts";

interface KeyOpts {
    code: string;
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    target?: HTMLElement;
}

function fireKey(opts: KeyOpts): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
        code: opts.code,
        key: opts.key,
        metaKey: opts.metaKey ?? false,
        ctrlKey: opts.ctrlKey ?? false,
        shiftKey: opts.shiftKey ?? false,
        altKey: opts.altKey ?? false,
        bubbles: true,
        cancelable: true,
    });
    if (opts.target) {
        // Mounting the element ensures dispatch sees a real target.
        if (!opts.target.isConnected) document.body.appendChild(opts.target);
        opts.target.dispatchEvent(event);
    } else {
        window.dispatchEvent(event);
    }
    return event;
}

/** "Mod" pressed = Meta on Mac, Control elsewhere. tinykeys reads navigator.platform
 *  at module load to decide. In jsdom navigator.platform is empty by default,
 *  so $mod resolves to "Control". We use ctrlKey in tests for that reason. */
const MOD = { ctrlKey: true } as const;

function makeHandlers() {
    return {
        onToggleBottomDock: vi.fn(),
        onSelectDockTab: vi.fn(),
        onToggleViewPane: vi.fn(),
        onToggleLayoutLock: vi.fn(),
        onSetGraphMode: vi.fn(),
        onShowHelp: vi.fn(),
        onEscape: vi.fn(),
    };
}

describe("isTextInput", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("returns true for input, textarea, select, contenteditable", () => {
        const input = document.createElement("input");
        const textarea = document.createElement("textarea");
        const select = document.createElement("select");
        const div = document.createElement("div");
        div.contentEditable = "true";
        expect(isTextInput(input)).toBe(true);
        expect(isTextInput(textarea)).toBe(true);
        expect(isTextInput(select)).toBe(true);
        expect(isTextInput(div)).toBe(true);
    });

    it("returns false for non-text elements and null", () => {
        const button = document.createElement("button");
        expect(isTextInput(button)).toBe(false);
        expect(isTextInput(null)).toBe(false);
    });
});

describe("useWorkspaceShortcuts", () => {
    let handlers: ReturnType<typeof makeHandlers>;

    beforeEach(() => {
        handlers = makeHandlers();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("Cmd/Ctrl+\\ fires onToggleBottomDock", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        fireKey({ code: "Backslash", key: "\\", ...MOD });
        expect(handlers.onToggleBottomDock).toHaveBeenCalledTimes(1);
    });

    it("Cmd/Ctrl+1 fires onSelectDockTab('audit')", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        fireKey({ code: "Digit1", key: "1", ...MOD });
        expect(handlers.onSelectDockTab).toHaveBeenCalledWith("audit");
    });

    it("Cmd/Ctrl+2 fires onSelectDockTab('triage')", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        fireKey({ code: "Digit2", key: "2", ...MOD });
        expect(handlers.onSelectDockTab).toHaveBeenCalledWith("triage");
    });

    it("Cmd/Ctrl+Shift+2 fires onToggleViewPane('990')", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        fireKey({ code: "Digit2", key: "2", ctrlKey: true, shiftKey: true });
        expect(handlers.onToggleViewPane).toHaveBeenCalledWith("990");
        // And does NOT also fire the unmodified dock-tab handler
        expect(handlers.onSelectDockTab).not.toHaveBeenCalled();
    });

    it("Cmd/Ctrl+Shift+4 fires onToggleViewPane('package')", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        fireKey({ code: "Digit4", key: "4", ctrlKey: true, shiftKey: true });
        expect(handlers.onToggleViewPane).toHaveBeenCalledWith("package");
    });

    it("Cmd/Ctrl+L fires onToggleLayoutLock (and not the bare-L graph mode)", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        fireKey({ code: "KeyL", key: "l", ...MOD });
        expect(handlers.onToggleLayoutLock).toHaveBeenCalledTimes(1);
        expect(handlers.onSetGraphMode).not.toHaveBeenCalled();
    });

    it("? fires onShowHelp", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        // "?" is Shift+/ on US keyboards. event.code = "Slash", event.key = "?".
        fireKey({ code: "Slash", key: "?", shiftKey: true });
        expect(handlers.onShowHelp).toHaveBeenCalledTimes(1);
    });

    it("V fires onSetGraphMode('pan') outside text input", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        fireKey({ code: "KeyV", key: "v" });
        expect(handlers.onSetGraphMode).toHaveBeenCalledWith("pan");
    });

    it("S fires onSetGraphMode('select') outside text input", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        fireKey({ code: "KeyS", key: "s" });
        expect(handlers.onSetGraphMode).toHaveBeenCalledWith("select");
    });

    it("bare L fires onSetGraphMode('link') outside text input", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        fireKey({ code: "KeyL", key: "l" });
        expect(handlers.onSetGraphMode).toHaveBeenCalledWith("link");
        expect(handlers.onToggleLayoutLock).not.toHaveBeenCalled();
    });

    it("V does NOT fire when typing inside an <input>", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        fireKey({ code: "KeyV", key: "v", target: input });
        expect(handlers.onSetGraphMode).not.toHaveBeenCalled();
    });

    it("V does NOT fire when typing inside a contenteditable", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        const editor = document.createElement("div");
        editor.contentEditable = "true";
        document.body.appendChild(editor);
        fireKey({ code: "KeyV", key: "v", target: editor });
        expect(handlers.onSetGraphMode).not.toHaveBeenCalled();
    });

    it("Esc fires onEscape when handler is provided", () => {
        renderHook(() => useWorkspaceShortcuts(handlers));
        fireKey({ code: "Escape", key: "Escape" });
        expect(handlers.onEscape).toHaveBeenCalledTimes(1);
    });

    it("does not register V/S/L bindings when onSetGraphMode is omitted", () => {
        const partialHandlers = {
            onToggleBottomDock: vi.fn(),
            onSelectDockTab: vi.fn(),
            onToggleViewPane: vi.fn(),
            onToggleLayoutLock: vi.fn(),
            onShowHelp: vi.fn(),
        };
        renderHook(() => useWorkspaceShortcuts(partialHandlers));
        // Bare V should be a no-op now
        const event = fireKey({ code: "KeyV", key: "v" });
        expect(event.defaultPrevented).toBe(false);
    });

    it("unsubscribes the keydown listener on unmount", () => {
        const { unmount } = renderHook(() => useWorkspaceShortcuts(handlers));
        unmount();
        fireKey({ code: "Backslash", key: "\\", ...MOD });
        expect(handlers.onToggleBottomDock).not.toHaveBeenCalled();
    });
});
