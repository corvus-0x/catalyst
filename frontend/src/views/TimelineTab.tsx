/**
 * TimelineTab.tsx — Brushable chronological investigation timeline.
 *
 * Spec reference: frontend-design-spec.md Section 12
 *
 * Layout:
 *   1. Filter chips (All · Documents · 990s · Transactions · UCC · Angles · Notes)
 *   2. D3 brushX SVG — shows full date range; brush selection zooms the event rail
 *   3. Scrollable event rail (dot row) + vertical event card list
 *
 * Vocabulary (CLAUDE.md):
 *   Lead   = AI-pattern-analysis result — never show "AI", "Claude", "LLM"
 *   Intake = Document extraction pipeline — never show "Haiku", "Claude", "AI"
 *   Angle  = Finding (the narrative unit tied to evidence)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import {
  Calendar,
  FileText,
  DollarSign,
  Home,
  CheckCircle2,
  StickyNote,
} from "lucide-react";
import { fetchGraph } from "../api";
import type { TimelineEvent } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TimelineTabProps {
  caseId: string;
  activeAngleId?: string;
  onCiteInAngle?: (event: TimelineEvent) => void;
}

// ---------------------------------------------------------------------------
// Filter configuration
// ---------------------------------------------------------------------------

type FilterKey = "all" | "document" | "financial" | "transaction" | "finding" | "ucc" | "note";

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  document: "Documents",
  financial: "990s",
  transaction: "Transactions",
  ucc: "UCC",
  finding: "Angles",
  note: "Notes",
};

// ---------------------------------------------------------------------------
// Event classification helpers
// ---------------------------------------------------------------------------

type EventClass = "document" | "financial" | "transaction" | "finding" | "ucc" | "note";

function getEventClass(event: TimelineEvent): EventClass {
  if (event.layer === "financial") return "financial";
  if (event.layer === "finding") return "finding";
  if (event.layer === "transaction") return "transaction";
  // For document layer, further distinguish by doc_type
  const dt = String(event.metadata.doc_type ?? "");
  if (dt === "UCC") return "ucc";
  return "document";
}

const CLASS_COLORS: Record<EventClass, string> = {
  financial: "#3b82f6",
  finding: "#16a34a",
  transaction: "#f59e0b",
  ucc: "#D85A30",
  document: "#9ca3af",
  note: "#8b5cf6",
};

// ---------------------------------------------------------------------------
// Date formatting helpers
// ---------------------------------------------------------------------------

const formatDate = d3.timeFormat("%b %d, %Y");
const formatYear = d3.timeFormat("%Y");

function parseDate(iso: string): Date {
  return new Date(iso);
}

function formatCurrency(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

// ---------------------------------------------------------------------------
// Severity badge helper
// ---------------------------------------------------------------------------

function getSeverityClass(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return "severity-badge severity-badge--critical";
    case "HIGH":
      return "severity-badge severity-badge--high";
    case "MEDIUM":
      return "severity-badge severity-badge--medium";
    default:
      return "severity-badge severity-badge--low";
  }
}

// ---------------------------------------------------------------------------
// Event card sub-components
// ---------------------------------------------------------------------------

function DocumentCard({ event, onCiteInAngle }: { event: TimelineEvent; onCiteInAngle?: (e: TimelineEvent) => void }) {
  const dt = String(event.metadata.doc_type ?? "OTHER");
  const badgeClass = `doc-badge doc-badge--${dt === "UCC" ? "UCC" : dt}`;
  return (
    <div className="event-card">
      <div className="event-card__header">
        <span className={`event-dot event-dot--${dt === "UCC" ? "ucc" : "document"}`}>
          <FileText size={12} />
        </span>
        <span className={badgeClass}>{dt}</span>
        <span className="event-card__meta">{event.label}</span>
      </div>
      <div className="event-card__excerpt">
        {formatDate(parseDate(event.date))} &middot; Extracted by Intake
      </div>
      {onCiteInAngle && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: 11, padding: "3px 8px" }}
            onClick={() => onCiteInAngle(event)}
          >
            Cite in angle
          </button>
        </div>
      )}
    </div>
  );
}

function FinancialCard({ event, onCiteInAngle }: { event: TimelineEvent; onCiteInAngle?: (e: TimelineEvent) => void }) {
  const taxYear = event.metadata.tax_year;
  const revenue = event.metadata.total_revenue;
  return (
    <div className="event-card">
      <div className="event-card__header">
        <span className="event-dot event-dot--financial">
          <DollarSign size={12} />
        </span>
        <span className="doc-badge doc-badge--IRS_990">IRS 990</span>
        <span className="event-card__meta">
          {event.label}
          {taxYear !== undefined ? ` · ${taxYear}` : ""}
        </span>
      </div>
      <div className="event-card__excerpt">
        {formatDate(parseDate(event.date))}
        {revenue !== undefined ? ` · Revenue: ${formatCurrency(revenue)}` : ""}
      </div>
      {onCiteInAngle && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: 11, padding: "3px 8px" }}
            onClick={() => onCiteInAngle(event)}
          >
            Cite in angle
          </button>
        </div>
      )}
    </div>
  );
}

function TransactionCard({ event, onCiteInAngle }: { event: TimelineEvent; onCiteInAngle?: (e: TimelineEvent) => void }) {
  const price = event.metadata.price;
  return (
    <div className="event-card">
      <div className="event-card__header">
        <span className="event-dot event-dot--transaction">
          <Home size={12} />
        </span>
        <span className="doc-badge doc-badge--DEED">DEED</span>
        <span className="event-card__meta">Property transaction</span>
      </div>
      <div className="event-card__excerpt">
        {formatDate(parseDate(event.date))}
        {price !== undefined ? ` · ${formatCurrency(price)}` : ""}
      </div>
      {onCiteInAngle && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: 11, padding: "3px 8px" }}
            onClick={() => onCiteInAngle(event)}
          >
            Cite in angle
          </button>
        </div>
      )}
    </div>
  );
}

function FindingCard({ event, onCiteInAngle }: { event: TimelineEvent; onCiteInAngle?: (e: TimelineEvent) => void }) {
  const severity = String(event.metadata.severity ?? "");
  const ruleId = String(event.metadata.rule_id ?? "");
  return (
    <div className="event-card">
      <div className="event-card__header">
        <span className="event-dot event-dot--finding">
          <CheckCircle2 size={12} />
        </span>
        <span className="angle-badge">CONFIRMED</span>
        <span className="event-card__meta">{event.label}</span>
      </div>
      <div className="event-card__excerpt">
        {formatDate(parseDate(event.date))}
        {ruleId ? ` · ${ruleId}` : ""}
        {severity ? (
          <>
            {" · "}
            <span className={getSeverityClass(severity)}>{severity}</span>
          </>
        ) : null}
      </div>
      {onCiteInAngle && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: 11, padding: "3px 8px" }}
            onClick={() => onCiteInAngle(event)}
          >
            Cite in angle
          </button>
        </div>
      )}
    </div>
  );
}

function NoteCard({ event, onCiteInAngle }: { event: TimelineEvent; onCiteInAngle?: (e: TimelineEvent) => void }) {
  return (
    <div className="event-card">
      <div className="event-card__header">
        <span className="event-dot event-dot--note">
          <StickyNote size={12} />
        </span>
        <span className="event-card__meta">{event.label}</span>
      </div>
      <div className="event-card__excerpt">
        {formatDate(parseDate(event.date))}
      </div>
      {onCiteInAngle && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: 11, padding: "3px 8px" }}
            onClick={() => onCiteInAngle(event)}
          >
            Cite in angle
          </button>
        </div>
      )}
    </div>
  );
}

function EventCard({ event, onCiteInAngle }: { event: TimelineEvent; onCiteInAngle?: (e: TimelineEvent) => void }) {
  const cls = getEventClass(event);
  if (cls === "financial") return <FinancialCard event={event} onCiteInAngle={onCiteInAngle} />;
  if (cls === "transaction") return <TransactionCard event={event} onCiteInAngle={onCiteInAngle} />;
  if (cls === "finding") return <FindingCard event={event} onCiteInAngle={onCiteInAngle} />;
  if (cls === "note") return <NoteCard event={event} onCiteInAngle={onCiteInAngle} />;
  // "document" and "ucc" both route through DocumentCard
  return <DocumentCard event={event} onCiteInAngle={onCiteInAngle} />;
}

// ---------------------------------------------------------------------------
// groupByDay helper — collapses events on the same calendar day for clustering
// ---------------------------------------------------------------------------

function groupByDay(events: TimelineEvent[]): Map<string, TimelineEvent[]> {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const key = e.date.slice(0, 10); // "YYYY-MM-DD"
    const existing = groups.get(key);
    if (existing) {
      existing.push(e);
    } else {
      groups.set(key, [e]);
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// ClusterCard — expandable card for same-day event groups (highlights UCC bursts)
// ---------------------------------------------------------------------------

function ClusterCard({
  day,
  events,
  onCiteInAngle,
}: {
  day: string;
  events: TimelineEvent[];
  onCiteInAngle?: (e: TimelineEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const uccCount = events.filter((e) => getEventClass(e) === "ucc").length;
  const isUccBurst = uccCount >= 3;

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          background: isUccBurst ? "#FAECE7" : "#f9fafb",
          border: `1px solid ${isUccBurst ? "#D85A30" : "#e5e7eb"}`,
          borderRadius: 6,
          padding: "6px 10px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
        aria-expanded={expanded ? "true" : "false"}
      >
        <span
          style={{
            background: isUccBurst ? "#D85A30" : "#6b7280",
            color: "#fff",
            borderRadius: 10,
            padding: "1px 7px",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {events.length}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500 }}>
          {isUccBurst ? `UCC burst — ${uccCount} filings same day` : `${events.length} events`}
        </span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>{day}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>
      {expanded && (
        <div style={{ paddingLeft: 12, borderLeft: "2px solid #e5e7eb", marginLeft: 8, marginTop: 4 }}>
          {events.map((e) => (
            <EventCard key={e.id} event={e} onCiteInAngle={onCiteInAngle} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TimelineTab({ caseId, activeAngleId: _activeAngleId, onCiteInAngle }: TimelineTabProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [brushRange, setBrushRange] = useState<[Date, Date] | null>(null);

  const brushSvgRef = useRef<SVGSVGElement | null>(null);
  const brushRef = useRef<d3.BrushBehavior<unknown> | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchGraph(caseId)
      .then((data) => {
        if (!cancelled) {
          setEvents(data.timeline_events ?? []);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Failed to load timeline events.";
          setError(msg);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [caseId]);

  // ── Filtered events (before brush) ───────────────────────────────────────

  const filteredEvents =
    activeFilter === "all"
      ? events
      : events.filter((e) => getEventClass(e) === activeFilter);

  // ── Visible events (filtered + brush range) ───────────────────────────────

  const visibleEvents = filteredEvents
    .filter((e) => {
      if (!brushRange) return true;
      const d = parseDate(e.date);
      return d >= brushRange[0] && d <= brushRange[1];
    })
    .sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());

  // ── D3 brush ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!events.length || !brushSvgRef.current) return;

    const svgEl = brushSvgRef.current;
    const W = svgEl.clientWidth || 600;
    const H = 36;
    const margin = { left: 8, right: 8 };

    const dates = events.map((e) => parseDate(e.date));
    const extent = d3.extent(dates) as [Date, Date];

    const xScale = d3
      .scaleTime()
      .domain(extent)
      .range([margin.left, W - margin.right]);

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    // Background track
    svg
      .append("rect")
      .attr("x", margin.left)
      .attr("y", 14)
      .attr("width", W - margin.left - margin.right)
      .attr("height", 8)
      .attr("rx", 4)
      .attr("fill", "#e5e7eb");

    // Tick marks for each event
    events.forEach((e) => {
      const cls = getEventClass(e);
      svg
        .append("circle")
        .attr("cx", xScale(parseDate(e.date)))
        .attr("cy", 18)
        .attr("r", 3)
        .attr("fill", CLASS_COLORS[cls] ?? "#9ca3af");
    });

    // Year labels along the top
    const years = Array.from(
      new Set(events.map((e) => parseDate(e.date).getFullYear()))
    ).sort((a, b) => a - b);

    years.forEach((year) => {
      svg
        .append("text")
        .attr("x", xScale(new Date(year, 0, 1)))
        .attr("y", 10)
        .attr("text-anchor", "middle")
        .attr("font-size", "10")
        .attr("fill", "#9ca3af")
        .text(formatYear(new Date(year, 0, 1)));
    });

    // D3 brushX
    const brush = d3
      .brushX<unknown>()
      .extent([
        [margin.left, 0],
        [W - margin.right, H],
      ])
      .on("end", (event: d3.D3BrushEvent<unknown>) => {
        if (!event.selection) {
          setBrushRange(null);
          return;
        }
        const [x0, x1] = event.selection as [number, number];
        setBrushRange([xScale.invert(x0), xScale.invert(x1)]);
      });

    brushRef.current = brush;
    svg.append("g").call(brush);
  }, [events]);

  // ── Reset brush ───────────────────────────────────────────────────────────

  const handleResetBrush = useCallback(() => {
    setBrushRange(null);
    if (brushSvgRef.current && brushRef.current) {
      d3.select(brushSvgRef.current).select<SVGGElement>("g").call(brushRef.current.clear);
    }
  }, []);

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="timeline-tab" style={{ height: "100%" }}>
        <div className="timeline-controls">
          {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => (
            <div key={key} className="skeleton filter-chip" style={{ width: 72, height: 28 }} />
          ))}
        </div>
        <div className="timeline-brush-area">
          <div className="skeleton" style={{ width: "100%", height: 36 }} />
        </div>
        <div className="timeline-scroll">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton event-card" style={{ height: 64, marginBottom: 8 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="timeline-tab" style={{ height: "100%" }}>
        <div className="empty-state">
          <Calendar size={32} />
          <p className="empty-state__title">Unable to load timeline</p>
          <p className="empty-state__body">{error}</p>
        </div>
      </div>
    );
  }

  // ── Empty states ──────────────────────────────────────────────────────────

  if (events.length === 0) {
    return (
      <div className="timeline-tab" style={{ height: "100%" }}>
        <div className="empty-state">
          <Calendar size={32} />
          <p className="empty-state__title">No timeline events found for this case.</p>
          <p className="empty-state__body">
            Upload documents or run external research to populate the timeline.
          </p>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  const emptyAfterFilter =
    visibleEvents.length === 0 && (activeFilter !== "all" || brushRange !== null);

  return (
    <div className="timeline-tab" style={{ height: "100%" }}>
      {/* ── Filter chips ─────────────────────────────────────────────────── */}
      <div className="timeline-controls">
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`filter-chip${activeFilter === key ? " filter-chip--active" : ""}`}
            onClick={() => setActiveFilter(key)}
          >
            {FILTER_LABELS[key]}
          </button>
        ))}

        {brushRange !== null && (
          <button
            type="button"
            className="toolbar-btn btn-secondary"
            onClick={handleResetBrush}
          >
            Reset
          </button>
        )}
      </div>

      {/* ── D3 brush ─────────────────────────────────────────────────────── */}
      <div className="timeline-brush-area">
        <svg
          ref={brushSvgRef}
          style={{ width: "100%", height: "36px", display: "block" }}
        />
      </div>

      {/* ── Event rail + cards ────────────────────────────────────────────── */}
      <div className="timeline-scroll">
        {/* Dot rail */}
        {visibleEvents.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              padding: "8px 0 12px",
              borderBottom: "1px solid var(--border, #e5e7eb)",
              marginBottom: "12px",
            }}
          >
            {visibleEvents.map((e) => {
              const cls = getEventClass(e);
              return (
                <span
                  key={e.id}
                  className={`event-dot event-dot--${cls}`}
                  title={`${e.label} — ${formatDate(parseDate(e.date))}`}
                />
              );
            })}
          </div>
        )}

        {/* Empty-after-filter state */}
        {emptyAfterFilter ? (
          <div className="empty-state">
            <Calendar size={28} />
            <p className="empty-state__title">
              No {activeFilter !== "all" ? FILTER_LABELS[activeFilter].toLowerCase() : ""} events
              {brushRange !== null ? " in the selected date range" : ""}.
            </p>
            <p className="empty-state__body">
              Adjust the filter chips or drag the brush to a wider range.
            </p>
          </div>
        ) : (
          /* Event cards — grouped by day; same-day events collapse into ClusterCard */
          (() => {
            const dayMap = groupByDay(visibleEvents);
            return Array.from(dayMap.entries()).map(([day, dayEvents]) =>
              dayEvents.length > 1 ? (
                <ClusterCard
                  key={day}
                  day={day}
                  events={dayEvents}
                  onCiteInAngle={onCiteInAngle}
                />
              ) : (
                <EventCard
                  key={dayEvents[0].id}
                  event={dayEvents[0]}
                  onCiteInAngle={onCiteInAngle}
                />
              )
            );
          })()
        )}
      </div>
    </div>
  );
}
