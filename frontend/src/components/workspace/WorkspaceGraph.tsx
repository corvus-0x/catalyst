/**
 * WorkspaceGraph — fetches the case graph and renders EntityGraphCytoscape.
 *
 * Sits in the case workspace center canvas (Zone 3). Owns the loading /
 * error / empty states; the graph component itself stays pure.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchCaseGraph } from "../../api";
import type { CaseGraphResponse, GraphNode } from "../../types";
import { EntityGraphCytoscape } from "./EntityGraphCytoscape";
import styles from "./EntityGraphCytoscape.module.css";

interface Props {
    caseId: string;
    /** Controlled selection — workspace owns this state so the right detail panel can read it. */
    selectedNodeId?: string | null;
    /** Fires for both selection and deselection (deselect = null). */
    onSelectNode?: (node: GraphNode | null) => void;
    /** Increment to force a graph re-fetch (e.g. after Research pane adds an entity). */
    version?: number;
}

export function WorkspaceGraph({ caseId, selectedNodeId, onSelectNode, version }: Props) {
    const [graph, setGraph] = useState<CaseGraphResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setError(null);
        (async () => {
            try {
                const data = await fetchCaseGraph(caseId);
                if (!cancelled) setGraph(data);
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Failed to load graph");
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [caseId, version]);

    const handleNodeClick = useCallback(
        (node: GraphNode) => {
            if (!onSelectNode) return;
            // Toggle: clicking the already-selected node deselects.
            onSelectNode(selectedNodeId === node.id ? null : node);
        },
        [onSelectNode, selectedNodeId],
    );

    if (error) {
        return <div className={styles.error}>Couldn&apos;t load graph: {error}</div>;
    }
    if (!graph) {
        return <div className={styles.loading}>Loading graph…</div>;
    }
    if (graph.nodes.length === 0) {
        return (
            <div className={styles.empty}>
                Graph is empty. Documents and entities appear here as the case is built.
            </div>
        );
    }

    return (
        <EntityGraphCytoscape
            nodes={graph.nodes}
            edges={graph.edges}
            onNodeClick={handleNodeClick}
            selectedNodeId={selectedNodeId}
        />
    );
}
