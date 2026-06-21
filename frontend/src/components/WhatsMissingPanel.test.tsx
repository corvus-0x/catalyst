import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import WhatsMissingPanel from "./WhatsMissingPanel";
import type { ReferralReadinessItem, ReferralReadinessResponse, ReferralReadinessStatus } from "../types";

const items: ReferralReadinessItem[] = [
  { key: "citation_coverage", label: "Citations", status: "FAIL", summary: "2 uncited", target_tab: "investigate" },
  { key: "financials", label: "Financials", status: "WARN", summary: "stale", target_tab: "financials" },
  { key: "done", label: "Done", status: "PASS", summary: "ok", target_tab: "referrals" },
];

// Boundary fixture helper — `quality` isn't exercised by this panel, so cast it once here
// instead of leaking `any` into the component. Everything else is type-accurate.
const readiness = (
  status: ReferralReadinessStatus,
  its: ReferralReadinessItem[],
  credibility = { referral_grade: 0, need_work: 0, agency_leads: 0 },
): ReferralReadinessResponse => ({
  status, summary: "", items: its,
  quality: undefined as unknown as ReferralReadinessResponse["quality"],
  credibility,
});

describe("WhatsMissingPanel", () => {
  it("renders FAIL/WARN only, FAIL first, omits PASS", () => {
    const { getByText, queryByText, container } = render(
      <WhatsMissingPanel readiness={readiness("BLOCKED", items, { referral_grade: 1, need_work: 2, agency_leads: 0 })} onNavigateTab={() => {}} onOpenPending={() => {}} />,
    );
    expect(getByText("Citations")).toBeTruthy();
    expect(getByText("Financials")).toBeTruthy();
    expect(queryByText("Done")).toBeNull();
    const labels = Array.from(container.querySelectorAll("[data-testid='wm-item']")).map((e) => e.textContent);
    expect(labels[0]).toContain("Citations"); // FAIL first
  });

  it("a cross-tab row click calls onNavigateTab", () => {
    const onNavigateTab = vi.fn();
    const { getByText } = render(
      <WhatsMissingPanel readiness={readiness("BLOCKED", items)} onNavigateTab={onNavigateTab} onOpenPending={() => {}} />,
    );
    fireEvent.click(getByText("Financials"));
    expect(onNavigateTab).toHaveBeenCalledWith("financials");
  });

  it("READY / no actionable items → quiet empty state", () => {
    const { getByText } = render(
      <WhatsMissingPanel readiness={readiness("READY", [items[2]], { referral_grade: 3, need_work: 0, agency_leads: 0 })} onNavigateTab={() => {}} onOpenPending={() => {}} />,
    );
    expect(getByText(/Nothing's blocking/)).toBeTruthy();
  });

  it("pending_connections FAIL calls onOpenPending and NOT onNavigateTab", () => {
    const onOpenPending = vi.fn();
    const onNavigateTab = vi.fn();
    const pendingItem: ReferralReadinessItem = {
      key: "pending_connections",
      label: "Pending relationships",
      status: "FAIL",
      summary: "3 unresolved",
      target_tab: "investigate",
    };
    const { getByText } = render(
      <WhatsMissingPanel
        readiness={readiness("BLOCKED", [pendingItem])}
        onNavigateTab={onNavigateTab}
        onOpenPending={onOpenPending}
      />,
    );
    fireEvent.click(getByText("Pending relationships"));
    expect(onOpenPending).toHaveBeenCalledTimes(1);
    expect(onNavigateTab).not.toHaveBeenCalled();
  });

  it("investigate-tab item that is NOT pending_connections calls neither handler", () => {
    // citation_coverage has target_tab "investigate" but key !== "pending_connections"
    // — clicking it must be a no-op (no cross-tab nav, no pending panel).
    const onOpenPending = vi.fn();
    const onNavigateTab = vi.fn();
    const citationItem: ReferralReadinessItem = {
      key: "citation_coverage",
      label: "Citations",
      status: "FAIL",
      summary: "2 uncited threads",
      target_tab: "investigate",
    };
    const { getByText } = render(
      <WhatsMissingPanel
        readiness={readiness("BLOCKED", [citationItem])}
        onNavigateTab={onNavigateTab}
        onOpenPending={onOpenPending}
      />,
    );
    fireEvent.click(getByText("Citations"));
    expect(onNavigateTab).not.toHaveBeenCalled();
    expect(onOpenPending).not.toHaveBeenCalled();
  });
});
