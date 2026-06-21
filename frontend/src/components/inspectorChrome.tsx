/**
 * inspectorChrome — shared micro-helpers for the compact inspector rails
 * (SubjectInspector, ThreadInspector). Keeps presentation logic DRY.
 */

export function sectionLabel(text: string) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: "var(--text-3)",
        marginTop: 12,
        marginBottom: 4,
      }}
    >
      {text}
    </div>
  );
}
