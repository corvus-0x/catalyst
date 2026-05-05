/**
 * Tabs — token-aware wrapper around @radix-ui/react-tabs.
 *
 * Per spec §9 the right detail panel uses tabs (Properties / Sources / Flags / Actions).
 * Per spec §10 the bottom dock uses tabs with counts (Audit · 47 / Triage · 9 / ...).
 *
 * Two visual variants:
 *   variant="line"     — underline indicator (right detail panel)
 *   variant="segmented"— pill-style segmented control (top-bar view toggles, smaller groupings)
 *
 * Usage:
 *   <Tabs.Root defaultValue="properties">
 *     <Tabs.List variant="line">
 *       <Tabs.Trigger value="properties">Properties</Tabs.Trigger>
 *       <Tabs.Trigger value="sources" badge={12}>Sources</Tabs.Trigger>
 *     </Tabs.List>
 *     <Tabs.Content value="properties">...</Tabs.Content>
 *     <Tabs.Content value="sources">...</Tabs.Content>
 *   </Tabs.Root>
 */
import { forwardRef, ReactNode } from "react";
import * as Radix from "@radix-ui/react-tabs";
import styles from "./Tabs.module.css";

const Root = Radix.Root;

type Variant = "line" | "segmented";

interface ListProps extends Radix.TabsListProps {
    variant?: Variant;
}

const List = forwardRef<HTMLDivElement, ListProps>(function List(
    { variant = "line", className, ...props },
    ref,
) {
    const classes = [styles.list, styles[variant], className].filter(Boolean).join(" ");
    return <Radix.List ref={ref} className={classes} {...props} />;
});

interface TriggerProps extends Radix.TabsTriggerProps {
    /** Optional count chip rendered to the right of the label (e.g. "Audit · 47"). */
    badge?: number | string;
    /** Optional leading icon (Lucide component or any node). */
    icon?: ReactNode;
}

const Trigger = forwardRef<HTMLButtonElement, TriggerProps>(function Trigger(
    { badge, icon, className, children, ...props },
    ref,
) {
    return (
        <Radix.Trigger
            ref={ref}
            className={[styles.trigger, className].filter(Boolean).join(" ")}
            {...props}
        >
            {icon && <span className={styles.icon}>{icon}</span>}
            <span>{children}</span>
            {badge !== undefined && badge !== null && (
                <span className={styles.badge}>{badge}</span>
            )}
        </Radix.Trigger>
    );
});

const Content = forwardRef<HTMLDivElement, Radix.TabsContentProps>(function Content(
    { className, ...props },
    ref,
) {
    return <Radix.Content ref={ref} className={[styles.content, className].filter(Boolean).join(" ")} {...props} />;
});

export const Tabs = { Root, List, Trigger, Content };
