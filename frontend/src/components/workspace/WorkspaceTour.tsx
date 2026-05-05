/**
 * WorkspaceTour — first-time-user 5-step guided tour per spec §15.5.
 *
 * Self-mounts on first case open (when localStorage["catalyst.tourSeen"]
 * is unset and a `caseId` prop is supplied). Sets the flag on completion
 * or dismissal so it never reappears for the same browser. Settings can
 * re-trigger via the imperative `forceStart()` ref handle.
 *
 * Renders nothing visible — driver.js owns the DOM during the tour.
 *
 * Targets are CSS selectors; the parent (CaseWorkspace) is responsible
 * for placing matching `data-tour="..."` attributes. Each step gracefully
 * skips itself if the target is missing at runtime (e.g. user is no
 * longer in cold-start mode so the canvas anchor doesn't exist).
 */
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
} from "react";
import { driver, Driver, DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import styles from "./WorkspaceTour.module.css";

export const TOUR_SEEN_KEY = "catalyst.tourSeen";

export interface WorkspaceTourHandle {
    /**
     * Force-start the tour, bypassing the localStorage gate. Used by the
     * Settings page to let the user replay the walkthrough on demand.
     */
    forceStart: () => void;
}

export interface WorkspaceTourProps {
    /**
     * The current case being viewed. Tour only fires when a case is open
     * (matches the spec: "On first case open"). When null/undefined the
     * effect is inert.
     */
    caseId?: string | null;
}

/**
 * The 5-step spec. Each `element` is a CSS selector the parent wires up
 * via `data-tour="..."` attributes. `onHighlightStarted` is a no-op here
 * but driver.js handles missing selectors by skipping the step on its own
 * once we filter out steps whose targets are absent at start time.
 */
const TOUR_STEPS: DriveStep[] = [
    {
        element: "[data-tour=\"cold-start\"]",
        popover: {
            title: "Start with a search",
            description:
                "Find your subject organization in IRS or Ohio SOS to begin.",
            side: "bottom",
            align: "center",
        },
    },
    {
        element: "[data-tour=\"phase-navigator\"]",
        popover: {
            title: "Phase navigator",
            description:
                "Track your progress as the case moves through Ingest → Detect → Investigate → Determine.",
            side: "right",
            align: "start",
        },
    },
    {
        element: "[data-tour=\"audit-log\"]",
        popover: {
            title: "Audit log",
            description:
                "Every action you take is recorded here. This is your chain of custody.",
            side: "top",
            align: "center",
        },
    },
    {
        element: "[data-tour=\"triage-tab\"]",
        popover: {
            title: "Triage",
            description:
                "Flags from automatic detections appear here for you to review and confirm.",
            side: "top",
            align: "center",
        },
    },
    {
        element: "[data-tour=\"package-toggle\"]",
        popover: {
            title: "Generate package",
            description:
                "When you're done, this is where you generate referral PDFs for the agencies.",
            side: "bottom",
            align: "end",
        },
    },
];

/**
 * Filter the spec'd steps down to just those whose target element is
 * actually mounted right now. Prevents driver.js from blowing up on a
 * missing selector — e.g. user already left the cold-start canvas.
 */
function selectAvailableSteps(steps: DriveStep[]): DriveStep[] {
    if (typeof document === "undefined") {
        return [];
    }
    return steps.filter((step) => {
        const sel = step.element;
        if (typeof sel !== "string") {
            return true;
        }
        try {
            return document.querySelector(sel) !== null;
        } catch {
            return false;
        }
    });
}

function markSeen(): void {
    try {
        localStorage.setItem(TOUR_SEEN_KEY, "true");
    } catch {
        // localStorage can be unavailable (private mode, quota); silently no-op
    }
}

function readSeen(): boolean {
    try {
        return localStorage.getItem(TOUR_SEEN_KEY) === "true";
    } catch {
        return false;
    }
}

export const WorkspaceTour = forwardRef<WorkspaceTourHandle, WorkspaceTourProps>(
    function WorkspaceTour({ caseId }, ref) {
        const driverRef = useRef<Driver | null>(null);
        const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

        const startTour = useCallback(() => {
            // Guard: tear down a previous instance if forceStart is hammered
            if (driverRef.current) {
                try {
                    driverRef.current.destroy();
                } catch {
                    // ignore — we're replacing it
                }
                driverRef.current = null;
            }

            const steps = selectAvailableSteps(TOUR_STEPS);
            if (steps.length === 0) {
                // Nothing to highlight. Mark seen so we don't keep retrying.
                markSeen();
                return;
            }

            const instance = driver({
                showProgress: true,
                allowClose: true,
                popoverClass: styles.tourTheme,
                steps,
                onDestroyed: () => {
                    markSeen();
                    driverRef.current = null;
                },
            });

            driverRef.current = instance;
            instance.drive();
        }, []);

        useImperativeHandle(
            ref,
            () => ({
                forceStart: () => {
                    startTour();
                },
            }),
            [startTour],
        );

        useEffect(() => {
            if (!caseId) {
                return;
            }
            if (readSeen()) {
                return;
            }
            // Wait 3 s so the graph layout and API calls finish loading
            // before the overlay appears. 300 ms was too fast and covered
            // a blank canvas, which confused users.
            startTimerRef.current = setTimeout(() => {
                startTour();
            }, 3000);

            return () => {
                if (startTimerRef.current) {
                    clearTimeout(startTimerRef.current);
                    startTimerRef.current = null;
                }
            };
        }, [caseId, startTour]);

        // Tear down the driver instance on unmount so we don't leak DOM.
        useEffect(() => {
            return () => {
                if (driverRef.current) {
                    try {
                        driverRef.current.destroy();
                    } catch {
                        // ignore
                    }
                    driverRef.current = null;
                }
            };
        }, []);

        return null;
    },
);
