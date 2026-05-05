/**
 * RecentlyAdded — left rail bottom strip per spec §7.3.
 *
 * Surfaces the 5 most recent entity / document / finding events for the
 * active case (the audit log preview). Internal-admin events (RECORD_*
 * mutations on internal tables, hash-batch verifications, etc.) are
 * filtered out — investigators care about ingest, flag fires, finding
 * creates, not row-level admin churn.
 *
 * Click → fires onItemSelected(entry). Parent decides whether that means
 * "focus this entity on the graph", "open this document", or "scroll
 * to this finding".
 *
 * Data source mirrors AuditLogPanel — same /api/activity-feed/ endpoint,
 * scoped to `caseId`.
 */
import { useEffect, useState } from "react";
import { fetchActivityFeed } from "../../api";
import type { ActivityEntry } from "../../types";
import { auditEventLabel, formatRelativeTime } from "./auditFormatting";
import styles from "./RecentlyAdded.module.css";

interface Props {
    caseId: string;
    onItemSelected?: (entry: ActivityEntry) => void;
    /**
     * Visible row cap — defaults to 5 per spec. Exposed so a parent can
     * show e.g. 8 rows on a tall screen without forking the component.
     */
    visibleCount?: number;
}

/**
 * Predicate: is this an event the investigator cares to see in the
 * recently-added strip?
 *
 * Surfaces:
 *   • DOCUMENT_*  — uploads, OCR completes, hash mismatches
 *   • FINDING_*   — created, updated
 *   • SIGNAL_*    — fired, confirmed, dismissed (treated as "Flag" rows)
 *   • RECORD_*    on entity tables (persons/organizations/properties) —
 *                  these represent entities being added to the case
 *
 * Hides:
 *   • RECORD_* on internal tables (audit_logs, settings, system_*)
 *   • HASH_VERIFICATION_BATCH and similar background-system events
 *   • REFERRAL_* and INTAKE_* (out of scope for this strip)
 */
export function isUserFacingEvent(entry: ActivityEntry): boolean {
    const action = (entry.action || "").toUpperCase();
    if (action.startsWith("DOCUMENT_")) return true;
    if (action.startsWith("FINDING_")) return true;
    if (action.startsWith("SIGNAL_")) return true;
    if (action.startsWith("RECORD_")) {
        const table = (entry.table_name || "").toLowerCase();
        return table === "persons"
            || table === "organizations"
            || table === "properties"
            || table === "financial_instruments";
    }
    // Anything else (HASH_VERIFICATION_BATCH, REFERRAL_*, INTAKE_*, internal
    // record events) is hidden from the strip.
    return false;
}

/** Bucket label that prefixes each row — "Doc · ", "Entity · ", etc. */
function categoryLabel(entry: ActivityEntry): string {
    const action = (entry.action || "").toUpperCase();
    if (action.startsWith("DOCUMENT_")) return "Doc";
    if (action.startsWith("FINDING_")) return "Finding";
    if (action.startsWith("SIGNAL_")) return "Flag";
    if (action.startsWith("RECORD_")) return "Entity";
    return "Event";
}

/** Body text for a row — entry.notes if present, else the audit label. */
function rowDescription(entry: ActivityEntry): string {
    if (entry.notes && entry.notes.trim().length > 0) return entry.notes;
    return auditEventLabel(entry.action, entry.table_name).label;
}

export function RecentlyAdded({ caseId, onItemSelected, visibleCount = 5 }: Props) {
    const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setEntries(null);
        setError(null);
        // Fetch a wider window than `visibleCount` because the predicate
        // filters out roughly half of raw audit rows (record-level mutations
        // on internal tables) — pulling 25 keeps the strip full even on
        // chatty cases.
        (async () => {
            try {
                const res = await fetchActivityFeed(25, caseId);
                if (!cancelled) setEntries(res.results);
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Failed to load");
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [caseId]);

    if (entries === null && !error) {
        return (
            <section className={styles.panel} aria-label="Recently added">
                <Header />
                <SkeletonList rows={visibleCount} />
            </section>
        );
    }

    if (error) {
        return (
            <section className={styles.panel} aria-label="Recently added">
                <Header />
                <p className={styles.error}>Couldn&apos;t load: {error}</p>
            </section>
        );
    }

    const filtered = (entries ?? []).filter(isUserFacingEvent).slice(0, visibleCount);

    if (filtered.length === 0) {
        return (
            <section className={styles.panel} aria-label="Recently added">
                <Header />
                <p className={styles.empty}>
                    No recent activity yet — items will appear here as you add documents,
                    entities, and findings.
                </p>
            </section>
        );
    }

    return (
        <section className={styles.panel} aria-label="Recently added">
            <Header />
            <ul className={styles.list}>
                {filtered.map((entry) => (
                    <li key={entry.id} className={styles.item}>
                        <button
                            type="button"
                            className={styles.row}
                            onClick={() => onItemSelected?.(entry)}
                            aria-label={`${categoryLabel(entry)}: ${rowDescription(entry)}`}
                        >
                            <span className={styles.bullet} aria-hidden>·</span>
                            <span className={styles.category}>{categoryLabel(entry)}</span>
                            <span className={styles.divider} aria-hidden>·</span>
                            <span className={styles.body} title={rowDescription(entry)}>
                                {rowDescription(entry)}
                            </span>
                            <span className={styles.time}>
                                {formatRelativeTime(entry.performed_at)}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function Header() {
    return (
        <h3 className={styles.heading}>RECENTLY ADDED</h3>
    );
}

function SkeletonList({ rows }: { rows: number }) {
    return (
        <ul className={styles.list} aria-busy="true" data-testid="recently-added-skeleton">
            {Array.from({ length: rows }).map((_, i) => (
                <li key={i} className={styles.item}>
                    <div className={styles.skeleton} />
                </li>
            ))}
        </ul>
    );
}
