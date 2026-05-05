/**
 * Popover — token-aware wrapper around @radix-ui/react-popover.
 *
 * Usage:
 *   <Popover.Root>
 *     <Popover.Trigger asChild><Button>Filter</Button></Popover.Trigger>
 *     <Popover.Content align="start" side="bottom">
 *       ...content...
 *     </Popover.Content>
 *   </Popover.Root>
 */
import { forwardRef } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import styles from "./Popover.module.css";

const Root = RadixPopover.Root;
const Trigger = RadixPopover.Trigger;
const Anchor = RadixPopover.Anchor;
const Close = RadixPopover.Close;
const Portal = RadixPopover.Portal;

interface ContentProps extends RadixPopover.PopoverContentProps {
    arrow?: boolean;
}

const Content = forwardRef<HTMLDivElement, ContentProps>(function Content(
    { arrow = true, className, sideOffset = 6, collisionPadding = 8, children, ...props },
    ref,
) {
    return (
        <RadixPopover.Portal>
            <RadixPopover.Content
                ref={ref}
                sideOffset={sideOffset}
                collisionPadding={collisionPadding}
                className={[styles.content, className].filter(Boolean).join(" ")}
                {...props}
            >
                {children}
                {arrow && <RadixPopover.Arrow className={styles.arrow} width={10} height={5} />}
            </RadixPopover.Content>
        </RadixPopover.Portal>
    );
});

export const Popover = { Root, Trigger, Anchor, Close, Portal, Content };
