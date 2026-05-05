import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    TOUR_SEEN_KEY,
    WorkspaceTour,
    WorkspaceTourHandle,
} from "./WorkspaceTour";

// Mock driver.js — its DOM machinery doesn't play well with jsdom and we
// only care that it gets called with the right config. Keep the shape
// consistent with the import so the component can call .drive() / .destroy().
const drive = vi.fn();
const destroy = vi.fn();
const driverFactory = vi.fn((_config?: unknown) => ({
    drive,
    destroy,
    isActive: () => false,
    refresh: () => undefined,
    setConfig: () => undefined,
    setSteps: () => undefined,
    getConfig: () => ({}),
    getState: () => undefined,
    getActiveIndex: () => undefined,
    isFirstStep: () => false,
    isLastStep: () => false,
    getActiveStep: () => undefined,
    getActiveElement: () => undefined,
    getPreviousElement: () => undefined,
    getPreviousStep: () => undefined,
    moveNext: () => undefined,
    movePrevious: () => undefined,
    moveTo: () => undefined,
    hasNextStep: () => false,
    hasPreviousStep: () => false,
    highlight: () => undefined,
}));

vi.mock("driver.js", () => ({
    driver: (config?: unknown) => driverFactory(config),
}));

// Mock the driver.css side-effect import so vitest doesn't try to parse CSS.
vi.mock("driver.js/dist/driver.css", () => ({}));

/**
 * Mount a DOM target for every tour step so `selectAvailableSteps` finds
 * something to highlight. Without these, the component will short-circuit
 * (mark seen, never call driver()).
 */
function mountTourAnchors(): HTMLElement {
    const root = document.createElement("div");
    const anchors = [
        "cold-start",
        "phase-navigator",
        "audit-log",
        "triage-tab",
        "package-toggle",
    ];
    for (const name of anchors) {
        const el = document.createElement("div");
        el.setAttribute("data-tour", name);
        root.appendChild(el);
    }
    document.body.appendChild(root);
    return root;
}

describe("WorkspaceTour", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        drive.mockClear();
        destroy.mockClear();
        driverFactory.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
        localStorage.clear();
    });

    it("does not fire the tour when localStorage[catalyst.tourSeen] is 'true'", () => {
        localStorage.setItem(TOUR_SEEN_KEY, "true");
        mountTourAnchors();

        render(<WorkspaceTour caseId="case-1" />);
        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(driverFactory).not.toHaveBeenCalled();
        expect(drive).not.toHaveBeenCalled();
    });

    it("fires the tour when tourSeen is missing and a caseId is supplied", () => {
        mountTourAnchors();

        render(<WorkspaceTour caseId="case-1" />);
        // The component schedules startTour() with a 300ms timeout.
        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(driverFactory).toHaveBeenCalledTimes(1);
        expect(drive).toHaveBeenCalledTimes(1);

        // It should have passed our 5 steps and our themed popover class.
        const cfg = driverFactory.mock.calls[0][0] as unknown as {
            steps: unknown[];
            popoverClass: string;
            showProgress: boolean;
        };
        expect(cfg.steps).toHaveLength(5);
        expect(cfg.showProgress).toBe(true);
        expect(typeof cfg.popoverClass).toBe("string");
        expect(cfg.popoverClass.length).toBeGreaterThan(0);
    });

    it("sets localStorage[catalyst.tourSeen] = 'true' when the tour completes", () => {
        mountTourAnchors();

        render(<WorkspaceTour caseId="case-1" />);
        act(() => {
            vi.advanceTimersByTime(3000);
        });

        // Pull the onDestroyed callback the component registered and invoke
        // it the way driver.js would when the user finishes / dismisses.
        const cfg = driverFactory.mock.calls[0][0] as unknown as {
            onDestroyed?: () => void;
        };
        expect(cfg.onDestroyed).toBeTypeOf("function");

        act(() => {
            cfg.onDestroyed?.();
        });

        expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe("true");
    });

    it("forceStart() via ref bypasses the tourSeen check and fires the tour", () => {
        localStorage.setItem(TOUR_SEEN_KEY, "true");
        mountTourAnchors();

        const ref = createRef<WorkspaceTourHandle>();
        render(<WorkspaceTour caseId="case-1" ref={ref} />);
        act(() => {
            vi.advanceTimersByTime(3000);
        });

        // Auto-fire suppressed by tourSeen='true'
        expect(driverFactory).not.toHaveBeenCalled();

        act(() => {
            ref.current?.forceStart();
        });

        expect(driverFactory).toHaveBeenCalledTimes(1);
        expect(drive).toHaveBeenCalledTimes(1);
    });

    it("renders nothing visible (effect-only component)", () => {
        mountTourAnchors();
        const { container } = render(<WorkspaceTour caseId="case-1" />);
        // No DOM children of consequence — the component returns null.
        expect(container.firstChild).toBeNull();
    });
});
