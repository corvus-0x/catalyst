/**
 * DropdownMenu — token-aware wrapper around @radix-ui/react-dropdown-menu.
 *
 * Usage:
 *   <DropdownMenu.Root>
 *     <DropdownMenu.Trigger asChild><Button>Layout ⌄</Button></DropdownMenu.Trigger>
 *     <DropdownMenu.Content>
 *       <DropdownMenu.Item onSelect={...}>Organic</DropdownMenu.Item>
 *       <DropdownMenu.Item onSelect={...}>Hierarchical</DropdownMenu.Item>
 *       <DropdownMenu.Separator />
 *       <DropdownMenu.CheckboxItem checked={...} onCheckedChange={...}>
 *         Show source documents
 *       </DropdownMenu.CheckboxItem>
 *     </DropdownMenu.Content>
 *   </DropdownMenu.Root>
 */
import { forwardRef } from "react";
import * as Radix from "@radix-ui/react-dropdown-menu";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";
import styles from "./Menu.module.css";

const Root = Radix.Root;
const Trigger = Radix.Trigger;
const Portal = Radix.Portal;
const Sub = Radix.Sub;
const RadioGroup = Radix.RadioGroup;

const Content = forwardRef<HTMLDivElement, Radix.DropdownMenuContentProps>(function Content(
    { className, sideOffset = 4, collisionPadding = 8, children, ...props },
    ref,
) {
    return (
        <Radix.Portal>
            <Radix.Content
                ref={ref}
                sideOffset={sideOffset}
                collisionPadding={collisionPadding}
                className={[styles.content, className].filter(Boolean).join(" ")}
                {...props}
            >
                {children}
            </Radix.Content>
        </Radix.Portal>
    );
});

interface ItemProps extends Radix.DropdownMenuItemProps {
    danger?: boolean;
    shortcut?: string;
}

const Item = forwardRef<HTMLDivElement, ItemProps>(function Item(
    { danger, shortcut, className, children, ...props },
    ref,
) {
    const classes = [styles.item, danger ? styles.itemDanger : undefined, className].filter(Boolean).join(" ");
    return (
        <Radix.Item ref={ref} className={classes} {...props}>
            {children}
            {shortcut && <span className={styles.shortcut}>{shortcut}</span>}
        </Radix.Item>
    );
});

const CheckboxItem = forwardRef<HTMLDivElement, Radix.DropdownMenuCheckboxItemProps>(
    function CheckboxItem({ className, children, ...props }, ref) {
        return (
            <Radix.CheckboxItem
                ref={ref}
                className={[styles.checkboxItem, className].filter(Boolean).join(" ")}
                {...props}
            >
                <span className={styles.indicator}>
                    <Radix.ItemIndicator>
                        <CheckIcon size={12} />
                    </Radix.ItemIndicator>
                </span>
                {children}
            </Radix.CheckboxItem>
        );
    },
);

const RadioItem = forwardRef<HTMLDivElement, Radix.DropdownMenuRadioItemProps>(
    function RadioItem({ className, children, ...props }, ref) {
        return (
            <Radix.RadioItem
                ref={ref}
                className={[styles.radioItem, className].filter(Boolean).join(" ")}
                {...props}
            >
                <span className={styles.indicator}>
                    <Radix.ItemIndicator>
                        <CircleIcon size={8} fill="currentColor" />
                    </Radix.ItemIndicator>
                </span>
                {children}
            </Radix.RadioItem>
        );
    },
);

const Label = forwardRef<HTMLDivElement, Radix.DropdownMenuLabelProps>(function Label(
    { className, ...props },
    ref,
) {
    return <Radix.Label ref={ref} className={[styles.label, className].filter(Boolean).join(" ")} {...props} />;
});

const Separator = forwardRef<HTMLDivElement, Radix.DropdownMenuSeparatorProps>(function Separator(
    { className, ...props },
    ref,
) {
    return (
        <Radix.Separator
            ref={ref}
            className={[styles.separator, className].filter(Boolean).join(" ")}
            {...props}
        />
    );
});

const SubTrigger = forwardRef<HTMLDivElement, Radix.DropdownMenuSubTriggerProps>(function SubTrigger(
    { className, children, ...props },
    ref,
) {
    return (
        <Radix.SubTrigger
            ref={ref}
            className={[styles.subTrigger, className].filter(Boolean).join(" ")}
            {...props}
        >
            {children}
            <span className={styles.shortcut}>
                <ChevronRightIcon size={12} />
            </span>
        </Radix.SubTrigger>
    );
});

const SubContent = forwardRef<HTMLDivElement, Radix.DropdownMenuSubContentProps>(function SubContent(
    { className, sideOffset = 2, ...props },
    ref,
) {
    return (
        <Radix.Portal>
            <Radix.SubContent
                ref={ref}
                sideOffset={sideOffset}
                className={[styles.content, className].filter(Boolean).join(" ")}
                {...props}
            />
        </Radix.Portal>
    );
});

export const DropdownMenu = {
    Root,
    Trigger,
    Portal,
    Content,
    Item,
    CheckboxItem,
    RadioItem,
    RadioGroup,
    Label,
    Separator,
    Sub,
    SubTrigger,
    SubContent,
};
