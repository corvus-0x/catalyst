import { useState } from "react";

const STRENGTH = ["Observed", "Documented", "Repeated", "Material"];

export default function CaseMapLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      position: "absolute",
      left: 12,
      bottom: 12,
      zIndex: 5,
      fontSize: 10,
      background: "var(--bg-1)",
      border: "1px solid var(--border-1)",
      borderRadius: 6,
      padding: 8,
      maxWidth: 240,
    }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          background: "none",
          border: "none",
          color: "var(--text-2)",
          cursor: "pointer",
          fontWeight: 700,
          padding: 0,
        }}
      >
        Legend {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: 6, color: "var(--text-3)", lineHeight: 1.5 }}>
          <div>
            <strong>Person</strong> — circle · <strong>Organization</strong> — square
          </div>
          <div>Dashed border — status not yet established</div>
          <div>Green border — substantiated thread · Amber dot — active thread</div>
          <div style={{ marginTop: 4 }}>Line weight: {STRENGTH.join(" · ")}</div>
          <div style={{ marginTop: 6 }}>
            Case Map lines show relationships found in source records or entered observations. Line
            weight reflects documentation and repetition. A relationship line does not imply wrongdoing.
          </div>
        </div>
      )}
    </div>
  );
}
