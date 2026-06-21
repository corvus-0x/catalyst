import type { CredibilityCounts } from "../types";

export function CredibilityHeader({ credibility }: { credibility?: CredibilityCounts }) {
  if (!credibility) return null;
  const { referral_grade, need_work, agency_leads } = credibility;
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
      <span style={{ color: "var(--color-success, #34d399)" }}>● {referral_grade} referral-grade</span>
      {"  ·  "}
      <span style={{ color: "#fbbf24" }}>◐ {need_work} need work</span>
      {"  ·  "}
      <span style={{ color: "var(--text-3)" }}>◷ {agency_leads} agency leads</span>
    </div>
  );
}
