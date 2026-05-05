/**
 * KeyboardHelpOverlay — workspace shortcut reference (spec §15).
 *
 * Controlled dialog: parent owns `open` and toggles via `onOpenChange`.
 * The `?` shortcut wired by `useWorkspaceShortcuts` calls the parent's
 * onShowHelp; the parent flips `open` to true.
 *
 * Cmd/Ctrl+K (command palette) is documented here for completeness even
 * though it's wired by a separate component.
 */
import { Fragment } from "react";
import { Dialog } from "../ui/Dialog";
import styles from "./KeyboardHelpOverlay.module.css";

interface KeyboardHelpOverlayProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface ShortcutRow {
    keys: string[];
    description: string;
}

interface ShortcutSection {
    title: string;
    rows: ShortcutRow[];
}

function isMacPlatform(): boolean {
    if (typeof navigator === "undefined") return false;
    const platform = navigator.platform ?? "";
    return platform.includes("Mac");
}

export function KeyboardHelpOverlay({ open, onOpenChange }: KeyboardHelpOverlayProps) {
    const mod = isMacPlatform() ? "Cmd" : "Ctrl";

    const sections: ShortcutSection[] = [
        {
            title: "Global",
            rows: [
                { keys: [mod, "K"], description: "Open command palette" },
                { keys: ["?"], description: "Show this keyboard reference" },
                { keys: ["Esc"], description: "Close dialogs, deselect" },
            ],
        },
        {
            title: "Layout",
            rows: [
                { keys: [mod, "\\"], description: "Toggle bottom dock" },
                { keys: [mod, "L"], description: "Toggle layout lock" },
                { keys: [mod, "1"], description: "Bottom dock: Audit" },
                { keys: [mod, "2"], description: "Bottom dock: Triage" },
                { keys: [mod, "3"], description: "Bottom dock: Transforms" },
                { keys: [mod, "4"], description: "Bottom dock: Documents" },
                { keys: [mod, "Shift", "1"], description: "View pane: Graph" },
                { keys: [mod, "Shift", "2"], description: "View pane: 990" },
                { keys: [mod, "Shift", "3"], description: "View pane: Financials" },
                { keys: [mod, "Shift", "4"], description: "View pane: Package" },
            ],
        },
        {
            title: "Graph",
            rows: [
                { keys: ["Space"], description: "Hold for temporary pan mode" },
                { keys: ["V"], description: "Switch to Pan mode" },
                { keys: ["S"], description: "Switch to Select mode" },
                { keys: ["L"], description: "Switch to Link mode" },
            ],
        },
    ];

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Content
                title="Keyboard shortcuts"
                description="Workspace navigation and graph commands."
                size="lg"
            >
                <div className={styles.body}>
                    <p className={styles.intro}>
                        Letter shortcuts (V, S, L, ?) are ignored while typing in
                        text fields. Modifier shortcuts always fire.
                    </p>
                    {sections.map((section) => (
                        <section key={section.title} className={styles.section}>
                            <h3 className={styles.sectionTitle}>{section.title}</h3>
                            <div className={styles.table} role="list">
                                {section.rows.map((row) => (
                                    <Fragment key={row.keys.join("+") + row.description}>
                                        <div
                                            className={styles.keysCell}
                                            role="listitem"
                                            aria-label={`${row.keys.join(" plus ")}: ${row.description}`}
                                        >
                                            {row.keys.map((key, i) => (
                                                <Fragment key={`${key}-${i}`}>
                                                    {i > 0 && (
                                                        <span
                                                            aria-hidden="true"
                                                            className={styles.plus}
                                                        >
                                                            +
                                                        </span>
                                                    )}
                                                    <kbd className={styles.key}>{key}</kbd>
                                                </Fragment>
                                            ))}
                                        </div>
                                        <div className={styles.descCell}>{row.description}</div>
                                    </Fragment>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </Dialog.Content>
        </Dialog.Root>
    );
}
