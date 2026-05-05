/**
 * Pure formatters for the audit log panel — split from the component so they
 * can be unit-tested without touching the React tree.
 *
 * Maps the AuditAction enum (defined in backend models.py) into a short label
 * + color category that drives the chip styling in AuditLogPanel.tsx.
 */
import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";

export type AuditEventCategory =
    | "document"   // DOCUMENT_*  → info/blue
    | "record"     // RECORD_*    → neutral
    | "signal"     // SIGNAL_*    → danger/red
    | "finding"    // FINDING_*   → success/green
    | "referral"   // REFERRAL_*  → ai/purple
    | "intake"     // INTAKE_*    → warn/amber
    | "system";    // catch-all   → neutral

export interface AuditEventLabel {
    label: string;
    category: AuditEventCategory;
}

/**
 * Convert (action, table_name) → display label + color category.
 *
 * Strategy: action is the source of truth (it's an enum). When the action is
 * a generic RECORD_* we fold the table_name in to disambiguate. Unknown
 * actions fall back to the raw string with `system` category.
 */
export function auditEventLabel(action: string, tableName: string): AuditEventLabel {
    const a = (action || "").toUpperCase();

    if (a.startsWith("DOCUMENT_")) {
        return { label: shorten(a), category: "document" };
    }
    if (a.startsWith("SIGNAL_")) {
        return { label: shorten(a), category: "signal" };
    }
    if (a.startsWith("FINDING_")) {
        return { label: shorten(a), category: "finding" };
    }
    if (a.startsWith("REFERRAL_")) {
        return { label: shorten(a), category: "referral" };
    }
    if (a.startsWith("INTAKE_")) {
        return { label: shorten(a), category: "intake" };
    }
    if (a.startsWith("RECORD_")) {
        const subject = humanizeTable(tableName);
        const verb = a.replace(/^RECORD_/, "");
        return { label: `${subject} ${verb.toLowerCase()}`, category: "record" };
    }
    if (a === "HASH_VERIFICATION_BATCH") {
        return { label: "Hash batch verified", category: "system" };
    }

    return { label: a || "EVENT", category: "system" };
}

/**
 * "DOCUMENT_INGESTED"        → "Doc ingested"
 * "DOCUMENT_HASH_MISMATCH"   → "Hash mismatch"
 * "FINDING_CREATED"          → "Finding created"
 * "SIGNAL_CONFIRMED"         → "Signal confirmed"
 */
function shorten(action: string): string {
    const map: Record<string, string> = {
        DOCUMENT_INGESTED: "Doc ingested",
        DOCUMENT_SCRUBBED: "Doc scrubbed",
        DOCUMENT_HASHED: "Doc hashed",
        DOCUMENT_HASH_VERIFIED: "Hash verified",
        DOCUMENT_HASH_MISMATCH: "Hash mismatch",
        DOCUMENT_DELETED: "Doc deleted",
        DOCUMENT_OCR_COMPLETED: "OCR complete",
        DOCUMENT_OCR_FAILED: "OCR failed",
        SIGNAL_DETECTED: "Flag fired",
        SIGNAL_CONFIRMED: "Flag confirmed",
        SIGNAL_DISMISSED: "Flag dismissed",
        SIGNAL_ESCALATED: "Promoted to finding",
        FINDING_CREATED: "Finding created",
        FINDING_UPDATED: "Finding updated",
        FINDING_INCLUDED: "Finding in package",
        REFERRAL_CREATED: "Referral created",
        REFERRAL_SUBMITTED: "Referral submitted",
        REFERRAL_STATUS_CHANGED: "Referral status",
        INTAKE_REJECTED_SIZE: "Rejected — size",
        INTAKE_REJECTED_TYPE: "Rejected — type",
        INTAKE_REJECTED_CORRUPT: "Rejected — corrupt",
    };
    return map[action] ?? action.replace(/_/g, " ").toLowerCase();
}

function humanizeTable(tableName: string): string {
    const t = tableName.toLowerCase();
    const map: Record<string, string> = {
        cases: "Case",
        documents: "Document",
        findings: "Finding",
        organizations: "Organization",
        persons: "Person",
        properties: "Property",
        investigator_notes: "Note",
        financial_instruments: "Financial instrument",
    };
    return map[t] ?? capitalize(t.replace(/_/g, " "));
}

function capitalize(s: string): string {
    return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Relative time for the audit log row.
 *   today      → "14:23"
 *   yesterday  → "Yesterday 14:23"
 *   < 7 days   → "3 days ago"
 *   older      → "Apr 14"
 */
export function formatRelativeTime(iso: string): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    if (isToday(d)) return format(d, "HH:mm");
    if (isYesterday(d)) return `Yesterday ${format(d, "HH:mm")}`;

    const diffMs = Date.now() - d.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (diffMs > 0 && diffMs < sevenDaysMs) {
        return formatDistanceToNowStrict(d, { addSuffix: true });
    }
    return format(d, "MMM d");
}

/**
 * Full datetime for hover/tooltip — "Apr 14 2026, 14:23:08".
 */
export function formatAbsoluteTime(iso: string): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return format(d, "MMM d yyyy, HH:mm:ss");
}
