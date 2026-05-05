/**
 * Tooltip — token-aware wrapper around @radix-ui/react-tooltip.
 *
 * Per spec §15.5 every icon should have a tooltip. Mount one <TooltipProvider>
 * near the app root (250ms delay matches spec).
 *
 * Usage:
 *   <Tooltip content="Lock layout">
 *     <button>🔒</button>
 *   </Tooltip>
 */
import { ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import styles from "./Tooltip.module.css";

export const TooltipProvider = ({ children, delayDuration = 250 }: { children: ReactNode; delayDuration?: number }) => (
    <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={150}>
        {children}
    </RadixTooltip.Provider>
);

interface TooltipProps {
    content: ReactNode;
    children: ReactNode;
    side?: RadixTooltip.TooltipContentProps["side"];
    align?: RadixTooltip.TooltipContentProps["align"];
    sideOffset?: number;
    /** When true, no arrow on the bubble. Defaults to false (arrow shown). */
    hideArrow?: boolean;
    /** Disable the tooltip (e.g. on touch devices, or when content is empty). */
    open?: boolean;
    defaultOpen?: boolean;
}

export function Tooltip({
    content,
    children,
    side = "top",
    align = "center",
    sideOffset = 6,
    hideArrow = false,
    open,
    defaultOpen,
}: TooltipProps) {
    if (!content) return <>{children}</>;
    return (
        <RadixTooltip.Root open={open} defaultOpen={defaultOpen}>
            <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
            <RadixTooltip.Portal>
                <RadixTooltip.Content
                    side={side}
                    align={align}
                    sideOffset={sideOffset}
                    className={styles.content}
                >
                    {content}
                    {!hideArrow && <RadixTooltip.Arrow className={styles.arrow} width={8} height={4} />}
                </RadixTooltip.Content>
            </RadixTooltip.Portal>
        </RadixTooltip.Root>
    );
}
