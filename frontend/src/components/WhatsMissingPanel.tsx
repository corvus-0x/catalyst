import { CredibilityHeader } from "./CredibilityHeader";
import type { ReferralReadinessItem, ReferralReadinessResponse, ReferralReadinessTargetTab } from "../types";

interface WhatsMissingPanelProps {
  readiness: ReferralReadinessResponse;
  onNavigateTab: (tab: ReferralReadinessTargetTab) => void;
  onOpenPending: () => void;
}

export default function WhatsMissingPanel({ readiness, onNavigateTab, onOpenPending }: WhatsMissingPanelProps) {
  const { credibility, items } = readiness;

  // Filter to actionable items only (FAIL or WARN), FAIL before WARN
  const actionable = items
    .filter((item) => item.status === "FAIL" || item.status === "WARN")
    .sort((a, b) => {
      if (a.status === b.status) return 0;
      return a.status === "FAIL" ? -1 : 1;
    });

  // Recipient-gap items (agency_leads) are deferred — show a muted footer note instead
  const hasAgencyLeads = credibility.agency_leads > 0;

  function handleRowClick(item: ReferralReadinessItem) {
    if (!item.target_tab) return;
    if (item.target_tab === "investigate") {
      // In-tab action: pending_connections opens the review panel; others are no-op
      if (item.key === "pending_connections") {
        onOpenPending();
      }
      // All other investigate-tab items stay in place (no cross-tab navigation)
    } else {
      onNavigateTab(item.target_tab);
    }
  }

  return (
    <div style={{ padding: 12, fontSize: 11, overflowY: "auto", height: "100%" }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--text-3)",
          marginBottom: 8,
        }}
      >
        Readiness
      </div>

      <CredibilityHeader credibility={credibility} />

      <hr style={{ border: "none", borderTop: "0.5px solid var(--border-1)", margin: "10px 0" }} />

      {actionable.length === 0 ? (
        <div style={{ color: "var(--text-3)", fontSize: 12, lineHeight: 1.5 }}>
          Nothing's blocking a referral — substantiate another thread or add a recipient.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {actionable.map((item) => {
            const isClickable =
              item.target_tab !== undefined &&
              (item.target_tab !== "investigate" || item.key === "pending_connections");
            return (
              <div
                key={item.key}
                data-testid="wm-item"
                className={`ref-readiness-item ref-readiness-item--${item.status.toLowerCase()}`}
                onClick={() => handleRowClick(item)}
                style={{ cursor: isClickable ? "pointer" : "default" }}
              >
                <div>
                  <p className="ref-readiness-item__label">{item.label}</p>
                  <p className="ref-readiness-item__summary">{item.summary}</p>
                </div>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    fontWeight: 700,
                    color: item.status === "FAIL" ? "var(--color-critical, #f87171)" : "#fbbf24",
                  }}
                >
                  {item.status === "FAIL" ? "Blocker" : "Review"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {hasAgencyLeads && (
        <>
          <hr style={{ border: "none", borderTop: "0.5px solid var(--border-1)", margin: "10px 0" }} />
          <div style={{ fontSize: 10, color: "var(--text-3)" }}>
            Agency leads — added in the referral package (coming)
          </div>
        </>
      )}
    </div>
  );
}
