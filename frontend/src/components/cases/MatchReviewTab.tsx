import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

import {
    fetchFuzzyCandidates,
    resolveFuzzyCandidate,
} from "../../api";
import type { FuzzyMatchCandidate, FuzzyMatchStatus } from "../../types";
import { CaseDetailContext } from "../../views/CaseDetailView";
import styles from "./MatchReviewTab.module.css";

type StatusFilter = "pending" | "merged" | "dismissed" | "all";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
    { id: "pending", label: "Pending" },
    { id: "merged", label: "Merged" },
    { id: "dismissed", label: "Dismissed" },
    { id: "all", label: "All" },
];

const HIGH_CONFIDENCE_THRESHOLD = 0.9;

function similarityClass(sim: number): string {
    return sim >= HIGH_CONFIDENCE_THRESHOLD
        ? styles.similarityHigh
        : styles.similarityFill;
}

function formatPercent(sim: number): string {
    return `${Math.round(sim * 100)}%`;
}

function CandidateCard({
    candidate,
    pendingAction,
    onAccept,
    onDismiss,
}: {
    candidate: FuzzyMatchCandidate;
    pendingAction: "accept" | "dismiss" | null;
    onAccept: () => void;
    onDismiss: () => void;
}): JSX.Element {
    const isResolved = candidate.status !== "PENDING";
    return (
        <div className={isResolved ? styles.cardResolved : styles.card}>
            <div className={styles.namesCol}>
                <span className={styles.entityType}>{candidate.entity_type}</span>
                <div className={styles.namePair}>
                    <span className={styles.incomingName}>
                        {candidate.incoming_raw}
                    </span>
                    <span className={styles.arrow}>~</span>
                    <span className={styles.existingName}>
                        {candidate.existing_raw}
                    </span>
                </div>
                <div className={styles.similarityRow}>
                    <span>{formatPercent(candidate.similarity)} match</span>
                    <div className={styles.similarityBar}>
                        <div
                            className={similarityClass(candidate.similarity)}
                            style={{ width: `${candidate.similarity * 100}%` }}
                        />
                    </div>
                </div>
            </div>

            <div className={styles.actionsCol}>
                {isResolved ? (
                    <span className={styles.resolvedBadge}>{candidate.status}</span>
                ) : (
                    <>
                        <button
                            type="button"
                            className={styles.dismissButton}
                            onClick={onDismiss}
                            disabled={pendingAction !== null}
                            title="Mark as not the same entity"
                        >
                            {pendingAction === "dismiss" ? "..." : "Dismiss"}
                        </button>
                        <button
                            type="button"
                            className={styles.acceptButton}
                            onClick={onAccept}
                            disabled={pendingAction !== null}
                            title="Confirm these are the same entity (mark for merge)"
                        >
                            {pendingAction === "accept" ? "..." : "Accept"}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

export function MatchReviewTab(): JSX.Element {
    const ctx = useOutletContext<CaseDetailContext>();
    const caseId = ctx.caseId;

    const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
    const [candidates, setCandidates] = useState<FuzzyMatchCandidate[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<{
        id: string;
        action: "accept" | "dismiss";
    } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetchFuzzyCandidates(caseId, {
                status: statusFilter,
            });
            setCandidates(response.results);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load candidates.");
        } finally {
            setLoading(false);
        }
    }, [caseId, statusFilter]);

    useEffect(() => {
        load();
    }, [load]);

    const handleResolve = async (
        candidate: FuzzyMatchCandidate,
        action: "accept" | "dismiss",
    ) => {
        setPendingAction({ id: candidate.id, action });
        try {
            const resolved = await resolveFuzzyCandidate(caseId, candidate.id, action);
            // Update locally so the UI reflects the change without a refetch.
            setCandidates((prev) =>
                prev.map((c) =>
                    c.id === candidate.id
                        ? {
                              ...c,
                              status: resolved.status as FuzzyMatchStatus,
                              resolved_at: resolved.resolved_at,
                          }
                        : c,
                ),
            );
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to update candidate.");
        } finally {
            setPendingAction(null);
        }
    };

    const visible =
        statusFilter === "pending"
            ? candidates.filter((c) => c.status === "PENDING")
            : candidates;

    return (
        <div className={styles.matchReview}>
            <div className={styles.toolbar}>
                <span className={styles.toolbarLabel}>Status:</span>
                {STATUS_FILTERS.map((f) => (
                    <button
                        key={f.id}
                        type="button"
                        className={
                            statusFilter === f.id
                                ? styles.statusButtonActive
                                : styles.statusButton
                        }
                        onClick={() => setStatusFilter(f.id)}
                    >
                        {f.label}
                    </button>
                ))}
                <div className={styles.toolbarSpacer} />
                <span className={styles.toolbarCount}>
                    {visible.length} {visible.length === 1 ? "candidate" : "candidates"}
                </span>
            </div>

            {loading ? (
                <div className={styles.stateBlock}>
                    <div className={styles.stateTitle}>Loading candidates…</div>
                </div>
            ) : error ? (
                <div className={styles.stateBlock}>
                    <div className={styles.stateTitle}>Couldn't load candidates</div>
                    <div className={styles.stateDetail}>{error}</div>
                </div>
            ) : visible.length === 0 ? (
                <div className={styles.stateBlock}>
                    <div className={styles.stateTitle}>
                        {statusFilter === "pending"
                            ? "No pending matches to review"
                            : "Nothing matches this filter"}
                    </div>
                    <div className={styles.stateDetail}>
                        {statusFilter === "pending"
                            ? "When the entity resolver finds an incoming name that closely matches an existing person or organization, it surfaces the pair here for you to confirm or dismiss instead of silent-merging."
                            : "Switch the status filter to see candidates in other states."}
                    </div>
                </div>
            ) : (
                <div className={styles.list}>
                    {visible.map((c) => (
                        <CandidateCard
                            key={c.id}
                            candidate={c}
                            pendingAction={
                                pendingAction?.id === c.id ? pendingAction.action : null
                            }
                            onAccept={() => handleResolve(c, "accept")}
                            onDismiss={() => handleResolve(c, "dismiss")}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
