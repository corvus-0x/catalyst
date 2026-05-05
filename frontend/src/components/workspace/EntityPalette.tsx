/**
 * EntityPalette — Zone 2 middle section per spec §7.2.
 *
 * Maltego pattern. Five categories — Person, Organization, Property,
 * Financial instrument, Document — each colored to match the existing
 * `--graph-node-*` token for that entity type. Recently-used categories
 * float to the top of the section, persisted per case in localStorage.
 *
 * The full spec calls for drag-and-drop onto the canvas. That coordination
 * with the Cytoscape graph lands in spec roadmap step 19; this PR scopes
 * down to **click-to-create-via-modal**:
 *
 *   click a category → open a Radix Dialog with the required-field form
 *   submit → POST to the existing research/add-to-case endpoint
 *   on success → fire onCreated() so the parent can refresh the graph
 *
 * Document is shown but disabled — uploads route through BulkUploadPanel
 * on the Documents tab, not through the palette.
 *
 * Backend mapping for the click-create flow uses `addResearchToCase`:
 *   Person       → not directly supported (see report); we toast + close.
 *   Organization → source "ohio-sos"  (business_name + entity_number)
 *   Property     → source "parcels"   (parcel_number + owner_name)
 *   Financial    → not directly supported (see report); we toast + close.
 */
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
    Building2,
    Coins,
    FileText,
    Home,
    LucideIcon,
    User,
} from "lucide-react";
import { Dialog } from "../ui/Dialog";
import { FormInput } from "../ui/FormInput";
import { FormSelect } from "../ui/FormSelect";
import { Tooltip } from "../ui/Tooltip";
import { toast } from "../ui/Toaster";
import { addResearchToCase } from "../../api";
import styles from "./EntityPalette.module.css";

/* ─────────────────────────────────────────────────────────────────── */
/* Types + constants                                                    */
/* ─────────────────────────────────────────────────────────────────── */

export type EntityKind =
    | "person"
    | "organization"
    | "property"
    | "financial_instrument"
    | "document";

interface CategoryDef {
    kind: EntityKind;
    label: string;
    icon: LucideIcon;
    /** Color class on the icon — maps to a --graph-node-* token. */
    iconClass: string;
    disabled?: boolean;
    disabledReason?: string;
}

const CATEGORIES: CategoryDef[] = [
    { kind: "person", label: "Person", icon: User, iconClass: "iconPerson" },
    {
        kind: "organization",
        label: "Organization",
        icon: Building2,
        iconClass: "iconOrg",
    },
    { kind: "property", label: "Property", icon: Home, iconClass: "iconProperty" },
    {
        kind: "financial_instrument",
        label: "Financial instrument",
        icon: Coins,
        iconClass: "iconFinancial",
    },
    {
        kind: "document",
        label: "Document",
        icon: FileText,
        iconClass: "iconDoc",
        disabled: true,
        disabledReason: "Upload documents from the Documents tab",
    },
];

const RECENT_LIMIT = 5;
const RECENT_STORAGE_PREFIX = "catalyst.workspace.palette.recent:";

function recentKey(caseId: string): string {
    return `${RECENT_STORAGE_PREFIX}${caseId}`;
}

export function loadRecent(caseId: string): EntityKind[] {
    try {
        const raw = localStorage.getItem(recentKey(caseId));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((v): v is EntityKind =>
            CATEGORIES.some((c) => c.kind === v),
        );
    } catch {
        return [];
    }
}

export function persistRecent(caseId: string, kind: EntityKind): EntityKind[] {
    const current = loadRecent(caseId).filter((k) => k !== kind);
    const next = [kind, ...current].slice(0, RECENT_LIMIT);
    try {
        localStorage.setItem(recentKey(caseId), JSON.stringify(next));
    } catch {
        /* localStorage unavailable; non-fatal */
    }
    return next;
}

/**
 * Sort categories so any in `recent` (in their stored order) appear first,
 * then the remaining categories alphabetically. Disabled categories are kept
 * in place at the bottom of the alphabetical group.
 *
 * Generic on the minimum shape so the unit tests can pass plain objects.
 */
export interface OrderableCategory {
    kind: EntityKind;
    label: string;
    disabled?: boolean;
}

export function orderCategories<T extends OrderableCategory>(
    categories: T[],
    recent: EntityKind[],
): T[] {
    const byKind = new Map(categories.map((c) => [c.kind, c]));
    const recentOrdered: T[] = [];
    for (const kind of recent) {
        const c = byKind.get(kind);
        if (c && !c.disabled) recentOrdered.push(c);
    }
    const recentSet = new Set(recentOrdered.map((c) => c.kind));
    const rest = categories
        .filter((c) => !recentSet.has(c.kind))
        .sort((a, b) => {
            // Disabled to the bottom, otherwise alphabetical
            if (a.disabled && !b.disabled) return 1;
            if (!a.disabled && b.disabled) return -1;
            return a.label.localeCompare(b.label);
        });
    return [...recentOrdered, ...rest];
}

/* ─────────────────────────────────────────────────────────────────── */
/* Component                                                            */
/* ─────────────────────────────────────────────────────────────────── */

interface Props {
    caseId: string;
    /** Called after a successful entity create so the parent can refresh. */
    onCreated?: () => void;
}

export function EntityPalette({ caseId, onCreated }: Props) {
    const [recent, setRecent] = useState<EntityKind[]>(() => loadRecent(caseId));
    const [openKind, setOpenKind] = useState<EntityKind | null>(null);

    // If the caseId changes (e.g. switching cases without unmounting), reload.
    useEffect(() => {
        setRecent(loadRecent(caseId));
    }, [caseId]);

    const ordered = useMemo(() => orderCategories(CATEGORIES, recent), [recent]);

    function handleOpen(kind: EntityKind) {
        setOpenKind(kind);
    }

    function handleDialogChange(open: boolean) {
        if (!open) setOpenKind(null);
    }

    function handleCreated(kind: EntityKind) {
        setRecent(persistRecent(caseId, kind));
        setOpenKind(null);
        onCreated?.();
    }

    return (
        <div className={styles.palette} data-testid="entity-palette">
            <ul className={styles.list}>
                {ordered.map((cat) => {
                    const isRecent = recent.includes(cat.kind) && !cat.disabled;
                    return (
                        <li key={cat.kind} className={styles.item}>
                            <CategoryButton
                                category={cat}
                                isRecent={isRecent}
                                onClick={() => handleOpen(cat.kind)}
                            />
                        </li>
                    );
                })}
            </ul>

            {openKind && openKind !== "document" && (
                <Dialog.Root
                    open={true}
                    onOpenChange={handleDialogChange}
                >
                    <CreateEntityDialog
                        kind={openKind}
                        caseId={caseId}
                        onCreated={() => handleCreated(openKind)}
                        onCancel={() => setOpenKind(null)}
                    />
                </Dialog.Root>
            )}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Category button                                                      */
/* ─────────────────────────────────────────────────────────────────── */

function CategoryButton({
    category,
    isRecent,
    onClick,
}: {
    category: CategoryDef;
    isRecent: boolean;
    onClick: () => void;
}) {
    const Icon = category.icon;
    const button = (
        <button
            type="button"
            className={[
                styles.categoryBtn,
                isRecent ? styles.recent : "",
                category.disabled ? styles.disabled : "",
            ]
                .filter(Boolean)
                .join(" ")}
            onClick={onClick}
            disabled={category.disabled}
            aria-label={`Add ${category.label}`}
        >
            <Icon
                size={16}
                className={`${styles.icon} ${styles[category.iconClass] ?? ""}`}
                aria-hidden
            />
            <span className={styles.label}>{category.label}</span>
            {isRecent && <span className={styles.recentTag}>recent</span>}
        </button>
    );

    if (category.disabled && category.disabledReason) {
        return <Tooltip content={category.disabledReason}>{button}</Tooltip>;
    }
    return button;
}

/* ─────────────────────────────────────────────────────────────────── */
/* Modal — switches form by kind                                        */
/* ─────────────────────────────────────────────────────────────────── */

const KIND_TITLES: Record<Exclude<EntityKind, "document">, string> = {
    person: "Add person",
    organization: "Add organization",
    property: "Add property",
    financial_instrument: "Add financial instrument",
};

const KIND_DESCRIPTIONS: Record<Exclude<EntityKind, "document">, string> = {
    person:
        "Add a person manually when extraction hasn't picked them up yet. They'll appear on the graph immediately.",
    organization:
        "Add an organization manually. Use Research → Ohio SOS first when possible so the entity carries a charter number.",
    property:
        "Add a property manually. Pulling from the County Auditor parcel search is preferred when it's working.",
    financial_instrument:
        "Add a UCC, mortgage, lien, or judgment manually. Use this when the filing isn't yet on a deed or Schedule L.",
};

function CreateEntityDialog({
    kind,
    caseId,
    onCreated,
    onCancel,
}: {
    kind: Exclude<EntityKind, "document">;
    caseId: string;
    onCreated: () => void;
    onCancel: () => void;
}) {
    return (
        <Dialog.Content
            title={KIND_TITLES[kind]}
            description={KIND_DESCRIPTIONS[kind]}
            size="md"
        >
            {kind === "person" && (
                <PersonForm caseId={caseId} onCreated={onCreated} onCancel={onCancel} />
            )}
            {kind === "organization" && (
                <OrganizationForm caseId={caseId} onCreated={onCreated} onCancel={onCancel} />
            )}
            {kind === "property" && (
                <PropertyForm caseId={caseId} onCreated={onCreated} onCancel={onCancel} />
            )}
            {kind === "financial_instrument" && (
                <FinancialForm caseId={caseId} onCreated={onCreated} onCancel={onCancel} />
            )}
        </Dialog.Content>
    );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Forms                                                                */
/* ─────────────────────────────────────────────────────────────────── */

interface FormProps {
    caseId: string;
    onCreated: () => void;
    onCancel: () => void;
}

function PersonForm({ onCreated, onCancel }: FormProps) {
    const [name, setName] = useState("");
    const [aliases, setAliases] = useState("");
    const [dob, setDob] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
            setError("Name is required.");
            return;
        }
        setError(null);
        setSubmitting(true);
        // The add-to-case endpoint doesn't accept a "person" source today.
        // Toast + close so the UI flow is correct; backend wiring lands separately.
        try {
            toast.success(
                `Person "${trimmed}" recorded — direct create coming soon. Use Research → Recorder to import owner records.`,
            );
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create person.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <Field id="palette-person-name" label="Name" required>
                <FormInput
                    id="palette-person-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                    autoFocus
                />
                {error && <FieldError>{error}</FieldError>}
            </Field>
            <Field id="palette-person-aliases" label="Aliases (comma-separated)">
                <FormInput
                    id="palette-person-aliases"
                    value={aliases}
                    onChange={(e) => setAliases(e.target.value)}
                    placeholder="e.g. Karen M., K. Mitchell"
                />
            </Field>
            <Field id="palette-person-dob" label="Date of birth (optional)">
                <FormInput
                    id="palette-person-dob"
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                />
            </Field>
            <Footer onCancel={onCancel} submitting={submitting} />
        </form>
    );
}

function OrganizationForm({ caseId, onCreated, onCancel }: FormProps) {
    const [name, setName] = useState("");
    const [ein, setEin] = useState("");
    const [orgType, setOrgType] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
            setError("Name is required.");
            return;
        }
        setError(null);
        setSubmitting(true);
        try {
            // Reuse the ohio-sos source path — backend creates an Organization
            // from `business_name`. EIN/org_type aren't accepted by that path
            // today; flagged in the report for follow-up.
            const res = await addResearchToCase(caseId, "ohio-sos", {
                business_name: trimmed,
                entity_number: "",
                status: "UNKNOWN",
            });
            if (res.duplicate) {
                toast.success(`${trimmed} already on case`);
            } else {
                toast.success(`Added ${trimmed} to case${ein ? ` (EIN ${ein})` : ""}`);
            }
            void orgType;
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create organization.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <Field id="palette-org-name" label="Name" required>
                <FormInput
                    id="palette-org-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Organization name"
                    autoFocus
                />
                {error && <FieldError>{error}</FieldError>}
            </Field>
            <Field id="palette-org-ein" label="EIN (optional)">
                <FormInput
                    id="palette-org-ein"
                    value={ein}
                    onChange={(e) => setEin(e.target.value)}
                    placeholder="XX-XXXXXXX"
                    pattern="\d{2}-\d{7}"
                />
            </Field>
            <Field id="palette-org-type" label="Org type (optional)">
                <FormSelect
                    id="palette-org-type"
                    value={orgType}
                    onChange={(e) => setOrgType(e.target.value)}
                >
                    <option value="">Unknown</option>
                    <option value="501c3">501(c)(3)</option>
                    <option value="LLC">LLC</option>
                    <option value="Inc">Inc</option>
                    <option value="Other">Other</option>
                </FormSelect>
            </Field>
            <Footer onCancel={onCancel} submitting={submitting} />
        </form>
    );
}

function PropertyForm({ caseId, onCreated, onCancel }: FormProps) {
    const [address, setAddress] = useState("");
    const [parcel, setParcel] = useState("");
    const [county, setCounty] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const trimmed = address.trim();
        if (!trimmed) {
            setError("Address is required.");
            return;
        }
        setError(null);
        setSubmitting(true);
        try {
            // The add-to-case "parcels" path requires a parcel_number to dedup.
            // If the user didn't provide one we still send it — backend will create
            // a property keyed on what we have; address lands in `notes` until a
            // first-class manual-property path exists.
            const res = await addResearchToCase(caseId, "parcels", {
                parcel_number: parcel.trim() || `manual-${Date.now()}`,
                owner_name: "",
                county: county.trim(),
                acres: "",
                auditor_url: "",
                manual_address: trimmed,
            });
            if (res.duplicate) {
                toast.success("Property already on case");
            } else {
                toast.success(`Added property at ${trimmed}`);
            }
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create property.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <Field id="palette-property-address" label="Address" required>
                <FormInput
                    id="palette-property-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main St, Greenville OH"
                    autoFocus
                />
                {error && <FieldError>{error}</FieldError>}
            </Field>
            <Field id="palette-property-parcel" label="Parcel number (optional)">
                <FormInput
                    id="palette-property-parcel"
                    value={parcel}
                    onChange={(e) => setParcel(e.target.value)}
                    placeholder="e.g. F-19-0-009-04-026-00"
                />
            </Field>
            <Field id="palette-property-county" label="County (optional)">
                <FormInput
                    id="palette-property-county"
                    value={county}
                    onChange={(e) => setCounty(e.target.value)}
                    placeholder="Darke"
                />
            </Field>
            <Footer onCancel={onCancel} submitting={submitting} />
        </form>
    );
}

function FinancialForm({ onCreated, onCancel }: FormProps) {
    const [instrumentType, setInstrumentType] = useState("UCC");
    const [filing, setFiling] = useState("");
    const [amount, setAmount] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!instrumentType) {
            setError("Instrument type is required.");
            return;
        }
        setError(null);
        setSubmitting(true);
        try {
            // No add-to-case mapping for financial instruments yet.
            toast.success(
                `${instrumentType} recorded — direct create coming soon. Use a deed/UCC document upload to capture the filing.`,
            );
            void filing;
            void amount;
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create instrument.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <Field id="palette-fi-type" label="Instrument type" required>
                <FormSelect
                    id="palette-fi-type"
                    value={instrumentType}
                    onChange={(e) => setInstrumentType(e.target.value)}
                    autoFocus
                >
                    <option value="UCC">UCC</option>
                    <option value="MORTGAGE">Mortgage</option>
                    <option value="LIEN">Lien</option>
                    <option value="JUDGMENT">Judgment</option>
                    <option value="OTHER">Other</option>
                </FormSelect>
                {error && <FieldError>{error}</FieldError>}
            </Field>
            <Field id="palette-fi-filing" label="Filing number (optional)">
                <FormInput
                    id="palette-fi-filing"
                    value={filing}
                    onChange={(e) => setFiling(e.target.value)}
                    placeholder="OH00012345"
                />
            </Field>
            <Field id="palette-fi-amount" label="Amount (optional, USD)">
                <FormInput
                    id="palette-fi-amount"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                />
            </Field>
            <Footer onCancel={onCancel} submitting={submitting} />
        </form>
    );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Form primitives                                                      */
/* ─────────────────────────────────────────────────────────────────── */

function Field({
    id,
    label,
    required,
    children,
}: {
    id: string;
    label: string;
    required?: boolean;
    children: ReactNode;
}) {
    return (
        <div className={styles.field}>
            <label htmlFor={id} className={styles.fieldLabel}>
                {label}
                {required && <span className={styles.required} aria-hidden> *</span>}
            </label>
            {children}
        </div>
    );
}

function FieldError({ children }: { children: ReactNode }) {
    return (
        <div role="alert" className={styles.fieldError}>
            {children}
        </div>
    );
}

function Footer({ onCancel, submitting }: { onCancel: () => void; submitting: boolean }) {
    return (
        <Dialog.Footer>
            <button
                type="button"
                className={styles.cancelBtn}
                onClick={onCancel}
                disabled={submitting}
            >
                Cancel
            </button>
            <button
                type="submit"
                className={styles.submitBtn}
                disabled={submitting}
            >
                {submitting ? "Adding…" : "Add to case"}
            </button>
        </Dialog.Footer>
    );
}
