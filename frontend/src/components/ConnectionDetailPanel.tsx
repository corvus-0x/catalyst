import { FileText, X } from "lucide-react";
import type { DocumentItem, GraphEdge, GraphResponse } from "../types";

interface ConnectionDetailPanelProps {
  edge: GraphEdge;
  graph: GraphResponse | null;
  documents: DocumentItem[];
  onOpenAngle: (angleId: string, angleTitle: string) => void;
  onOpenDocument: (docId: string, docName: string) => void;
  onClear: () => void;
}

function nodeLabel(graph: GraphResponse | null, nodeId: string): string {
  return graph?.nodes.find((node) => node.id === nodeId)?.label ?? `${nodeId.slice(0, 8)}…`;
}

function connectionState(edge: GraphEdge): "confirmed" | "proposed" | "manual" {
  if (edge.relationship === "CO_APPEARS_IN") return "proposed";
  if (
    ["FAMILY", "BUSINESS", "SOCIAL"].includes(edge.relationship) &&
    edge.metadata.source_type === "MANUAL"
  ) {
    return "manual";
  }
  return "confirmed";
}

function documentIds(edge: GraphEdge): string[] {
  return Array.isArray(edge.metadata.document_ids) ? edge.metadata.document_ids : [];
}

function formatCurrency(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
}

function metadataRows(edge: GraphEdge): Array<{ label: string; value: string }> {
  const meta = edge.metadata;
  const rows: Array<{ label: string; value: string }> = [];

  if (edge.relationship === "OFFICER_OF") {
    if (meta.start_date) rows.push({ label: "Start date", value: String(meta.start_date) });
    if (meta.end_date) rows.push({ label: "End date", value: String(meta.end_date) });
  }

  if (edge.relationship === "CO_APPEARS_IN") {
    rows.push({ label: "Supporting records", value: String(edge.weight) });
  }

  if (edge.relationship === "PURCHASED" || edge.relationship === "SOLD_BY") {
    if (meta.transaction_date) {
      rows.push({ label: "Transaction date", value: String(meta.transaction_date) });
    }
    const price = formatCurrency(meta.price);
    if (price) rows.push({ label: "Price", value: price });
    if (meta.instrument_number) {
      rows.push({ label: "Instrument", value: String(meta.instrument_number) });
    }
  }

  if (
    edge.relationship === "FAMILY" ||
    edge.relationship === "BUSINESS" ||
    edge.relationship === "SOCIAL"
  ) {
    if (meta.source_type) rows.push({ label: "Source", value: String(meta.source_type) });
    if (typeof meta.confidence === "number") {
      rows.push({ label: "Confidence", value: `${Math.round(meta.confidence * 100)}%` });
    }
    if (meta.notes) rows.push({ label: "Notes", value: String(meta.notes) });
  }

  return rows;
}

export default function ConnectionDetailPanel({
  edge,
  graph,
  documents,
  onOpenAngle,
  onOpenDocument,
  onClear,
}: ConnectionDetailPanelProps) {
  const fromLabel = nodeLabel(graph, edge.source);
  const toLabel = nodeLabel(graph, edge.target);
  const state = connectionState(edge);
  const supportingDocIds = documentIds(edge);
  const supportingDocs = supportingDocIds
    .map((id) => documents.find((doc) => doc.id === id))
    .filter((doc): doc is DocumentItem => doc !== undefined);
  const missingDocCount = supportingDocIds.length - supportingDocs.length;
  const rows = metadataRows(edge);

  return (
    <aside className="connection-detail" aria-label="Connection detail">
      <div className="connection-detail__header">
        <div>
          <p className="connection-detail__eyebrow">Connection</p>
          <h3 className="connection-detail__title">{edge.label || edge.relationship}</h3>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={onClear}
          aria-label="Clear selected connection"
          title="Clear"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="connection-detail__nodes">
        <div className="connection-detail__node">{fromLabel}</div>
        <div className="connection-detail__connector">↔</div>
        <div className="connection-detail__node">{toLabel}</div>
      </div>

      <div className="connection-detail__meta-line">
        <span className={`conn-state-badge conn-state-badge--${state}`}>{state}</span>
        <span>{edge.relationship.replace(/_/g, " ")}</span>
      </div>

      {rows.length > 0 && (
        <section className="connection-detail__section">
          <p className="panel-section__title">Metadata</p>
          <dl className="connection-detail__facts">
            {rows.map((row) => (
              <div key={`${row.label}:${row.value}`} className="connection-detail__fact">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="connection-detail__section">
        <p className="panel-section__title">Evidence</p>
        {supportingDocs.length > 0 ? (
          <div className="connection-detail__list">
            {supportingDocs.map((doc) => (
              <button
                key={doc.id}
                type="button"
                className="connection-detail__doc"
                onClick={() => onOpenDocument(doc.id, doc.display_name || doc.filename)}
              >
                <FileText size={13} aria-hidden="true" />
                <span>{doc.display_name || doc.filename}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="connection-detail__empty">No source documents attached.</p>
        )}
        {missingDocCount > 0 && (
          <p className="connection-detail__note">
            {missingDocCount} supporting document reference
            {missingDocCount === 1 ? "" : "s"} could not be resolved in the case list.
          </p>
        )}
      </section>

      <section className="connection-detail__section">
        <p className="panel-section__title">Angles</p>
        {edge.finding_links.length > 0 ? (
          <div className="connection-detail__list">
            {edge.finding_links.map((angle) => (
              <button
                key={angle.finding_id}
                type="button"
                className="connection-detail__angle"
                onClick={() => onOpenAngle(angle.finding_id, angle.title)}
              >
                <span className={`severity-badge severity-badge--${angle.severity}`}>
                  {angle.severity}
                </span>
                <span className="connection-detail__angle-title">{angle.title}</span>
                <span className={`angle-badge angle-badge--${angle.status}`}>{angle.status}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="connection-detail__empty">No Angles use this connection yet.</p>
        )}
      </section>
    </aside>
  );
}
