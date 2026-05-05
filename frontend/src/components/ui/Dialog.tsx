/**
 * Dialog — token-aware wrapper around @radix-ui/react-dialog.
 *
 * Usage:
 *   <Dialog.Root>
 *     <Dialog.Trigger asChild><Button>Open</Button></Dialog.Trigger>
 *     <Dialog.Content title="Title" description="Optional desc">
 *       ...body...
 *       <Dialog.Footer>
 *         <Dialog.Close asChild><Button>Cancel</Button></Dialog.Close>
 *       </Dialog.Footer>
 *     </Dialog.Content>
 *   </Dialog.Root>
 */
import { forwardRef, ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import styles from "./Dialog.module.css";

const Root = RadixDialog.Root;
const Trigger = RadixDialog.Trigger;
const Close = RadixDialog.Close;
const Portal = RadixDialog.Portal;

interface ContentProps extends RadixDialog.DialogContentProps {
    title: string;
    description?: string;
    showClose?: boolean;
    overlayClassName?: string;
    size?: "sm" | "md" | "lg";
}

const Content = forwardRef<HTMLDivElement, ContentProps>(function Content(
    { title, description, showClose = true, overlayClassName, size = "md", className, children, ...props },
    ref,
) {
    const contentClasses = [styles.content, styles[size], className].filter(Boolean).join(" ");
    return (
        <RadixDialog.Portal>
            <RadixDialog.Overlay className={[styles.overlay, overlayClassName].filter(Boolean).join(" ")} />
            <RadixDialog.Content ref={ref} className={contentClasses} {...props}>
                <header className={styles.header}>
                    <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
                    {showClose && (
                        <RadixDialog.Close aria-label="Close" className={styles.closeBtn}>
                            <XIcon size={16} />
                        </RadixDialog.Close>
                    )}
                </header>
                {description && (
                    <RadixDialog.Description className={styles.description}>
                        {description}
                    </RadixDialog.Description>
                )}
                <div className={styles.body}>{children}</div>
            </RadixDialog.Content>
        </RadixDialog.Portal>
    );
});

function Footer({ children }: { children: ReactNode }) {
    return <footer className={styles.footer}>{children}</footer>;
}

export const Dialog = { Root, Trigger, Close, Portal, Content, Footer };
