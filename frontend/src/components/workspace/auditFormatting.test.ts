import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { auditEventLabel, formatAbsoluteTime, formatRelativeTime } from "./auditFormatting";

describe("auditEventLabel", () => {
    it("categorizes DOCUMENT_* actions as document", () => {
        expect(auditEventLabel("DOCUMENT_INGESTED", "documents")).toEqual({
            label: "Doc ingested",
            category: "document",
        });
        expect(auditEventLabel("DOCUMENT_HASH_MISMATCH", "documents").category).toBe("document");
        expect(auditEventLabel("DOCUMENT_OCR_FAILED", "documents").label).toBe("OCR failed");
    });

    it("categorizes SIGNAL_* actions as signal (red)", () => {
        expect(auditEventLabel("SIGNAL_DETECTED", "findings")).toEqual({
            label: "Flag fired",
            category: "signal",
        });
        expect(auditEventLabel("SIGNAL_DISMISSED", "findings").category).toBe("signal");
    });

    it("categorizes FINDING_* actions as finding (green)", () => {
        expect(auditEventLabel("FINDING_CREATED", "findings")).toEqual({
            label: "Finding created",
            category: "finding",
        });
    });

    it("categorizes REFERRAL_* actions as referral (purple)", () => {
        expect(auditEventLabel("REFERRAL_SUBMITTED", "cases").category).toBe("referral");
    });

    it("categorizes INTAKE_REJECTED_* actions as intake (warn)", () => {
        expect(auditEventLabel("INTAKE_REJECTED_TYPE", "documents")).toEqual({
            label: "Rejected — type",
            category: "intake",
        });
    });

    it("folds RECORD_* actions with table_name to humanize the subject", () => {
        expect(auditEventLabel("RECORD_CREATED", "persons")).toEqual({
            label: "Person created",
            category: "record",
        });
        expect(auditEventLabel("RECORD_UPDATED", "organizations")).toEqual({
            label: "Organization updated",
            category: "record",
        });
        expect(auditEventLabel("RECORD_DELETED", "investigator_notes")).toEqual({
            label: "Note deleted",
            category: "record",
        });
    });

    it("falls back to system category for unknown actions", () => {
        expect(auditEventLabel("MYSTERY_ACTION", "documents")).toEqual({
            label: "MYSTERY_ACTION",
            category: "system",
        });
    });

    it("handles empty action string without crashing", () => {
        expect(auditEventLabel("", "documents").category).toBe("system");
    });
});

describe("formatRelativeTime", () => {
    // Pin clock so "today / yesterday / older" branches are deterministic.
    const NOW = new Date("2026-05-04T15:00:00Z");

    beforeAll(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    it("returns HH:mm for events earlier today", () => {
        const earlierToday = new Date("2026-05-04T08:23:00Z").toISOString();
        const out = formatRelativeTime(earlierToday);
        // Format depends on local TZ; assert HH:mm shape rather than exact value.
        expect(out).toMatch(/^\d{2}:\d{2}$/);
    });

    it("prefixes 'Yesterday' for yesterday's events", () => {
        const yesterday = new Date("2026-05-03T14:00:00Z").toISOString();
        expect(formatRelativeTime(yesterday)).toMatch(/^Yesterday \d{2}:\d{2}$/);
    });

    it("returns relative phrase within 7 days", () => {
        const threeDaysAgo = new Date("2026-05-01T15:00:00Z").toISOString();
        expect(formatRelativeTime(threeDaysAgo)).toContain("ago");
    });

    it("returns abbreviated date for older events", () => {
        const monthAgo = new Date("2026-03-14T12:00:00Z").toISOString();
        // "Mar 14" — locale-friendly format. Just check we got a month abbrev + day.
        expect(formatRelativeTime(monthAgo)).toMatch(/^[A-Z][a-z]{2} \d+$/);
    });

    it("returns em-dash for empty input", () => {
        expect(formatRelativeTime("")).toBe("—");
    });
});

describe("formatAbsoluteTime", () => {
    it("returns full datetime", () => {
        const out = formatAbsoluteTime("2026-04-14T14:23:08Z");
        expect(out).toMatch(/Apr 14 2026, \d{2}:\d{2}:\d{2}/);
    });

    it("returns em-dash for empty input", () => {
        expect(formatAbsoluteTime("")).toBe("—");
    });
});
