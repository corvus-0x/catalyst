import { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhaseNavigator } from "./PhaseNavigator";
import { TooltipProvider } from "../ui/Tooltip";
import {
    DocumentItem,
    FindingItem,
    SearchJobSummary,
} from "../../types";

// ──────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function jsonResponse(body: unknown) {
    return {
        ok: true,
        status: 200,
        json: async () => body,
        headers: new Headers({ "content-type": "application/json" }),
    };
}

function makeDoc(partial: Partial<DocumentItem> = {}): DocumentItem {
    return {
        id: "doc-" + Math.random().toString(36).slice(2, 8),
        filename: "test.pdf",
        display_name: "test.pdf",
        file_path: "/media/docs/test.pdf",
        sha256_hash: "0".repeat(64),
        file_size: 1024,
        doc_type: "OTHER",
        is_generated: false,
        doc_subtype: "",
        source_url: null,
        ocr_status: "NOT_NEEDED",
        uploaded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...partial,
    };
}

function makeFinding(partial: Partial<FindingItem> = {}): FindingItem {
    return {
        id: "f-" + Math.random().toString(36).slice(2, 8),
        rule_id: "SR-015",
        title: "Test finding",
        description: "test",
        narrative: "",
        severity: "HIGH",
        status: "NEW",
        evidence_weight: "DIRECTIONAL",
        source: "AUTO",
        investigator_note: "",
        legal_refs: [],
        evidence_snapshot: {},
        trigger_doc_id: null,
        trigger_doc_filename: null,
        trigger_entity_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        entity_links: [],
        document_links: [],
        ...partial,
    };
}

function makeJob(partial: Partial<SearchJobSummary> = {}): SearchJobSummary {
    return {
        id: "j-" + Math.random().toString(36).slice(2, 8),
        job_type: "IRS_NAME_SEARCH",
        status: "SUCCESS",
        query_params: {},
        result: null,
        error_message: "",
        created_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
        ...partial,
    };
}

interface ResponseSet {
    docs?: DocumentItem[];
    findings?: FindingItem[];
    jobs?: SearchJobSummary[];
    /** If set, fail when matching URL substring. */
    fail?: { caseDetail?: boolean; findings?: boolean; jobs?: boolean };
}

/** Wire up `fetch` to dispatch by URL pattern. */
function mockFetchSet(set: ResponseSet) {
    const docs = set.docs ?? [];
    const findings = set.findings ?? [];
    const jobs = set.jobs ?? [];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async (input: string | URL) => {
            const url = String(input);
            // /api/cases/<id>/findings/
            if (url.includes("/findings/")) {
                if (set.fail?.findings) throw new Error("findings down");
                return jsonResponse({
                    count: findings.length,
                    limit: 100,
                    offset: 0,
                    next_offset: null,
                    previous_offset: null,
                    results: findings,
                });
            }
            // /api/cases/<id>/jobs/?limit=50
            if (url.includes("/jobs/")) {
                if (set.fail?.jobs) throw new Error("jobs down");
                return jsonResponse({ results: jobs });
            }
            // /api/cases/<id>/
            if (url.includes("/api/cases/")) {
                if (set.fail?.caseDetail) throw new Error("case detail down");
                return jsonResponse({
                    id: "case-1",
                    name: "Test case",
                    status: "ACTIVE",
                    notes: "",
                    referral_ref: "",
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    documents: docs,
                });
            }
            throw new Error("Unhandled URL: " + url);
        },
    );
}

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

describe("PhaseNavigator", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders all four phase headers", async () => {
        mockFetchSet({});

        renderWithProviders(<PhaseNavigator caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("INGEST")).toBeInTheDocument();
            expect(screen.getByText("DETECT")).toBeInTheDocument();
            expect(screen.getByText("INVESTIGATE")).toBeInTheDocument();
            expect(screen.getByText("DETERMINE")).toBeInTheDocument();
        });
    });

    it("shows the correct INGEST count (sum of documents)", async () => {
        mockFetchSet({
            docs: [
                makeDoc({ doc_type: "IRS_990" }),
                makeDoc({ doc_type: "IRS_990" }),
                makeDoc({ doc_type: "SOS_FILING" }),
                makeDoc({ doc_type: "DEED" }),
                makeDoc({ doc_type: "OTHER" }),
            ],
        });

        renderWithProviders(<PhaseNavigator caseId="case-1" />);

        await waitFor(() => {
            // Header summary shows total
            expect(screen.getByText(/^5 docs$/)).toBeInTheDocument();
        });

        // 990s bucket = 2
        const bucket990 = screen.getByRole("button", { name: /^990s/i });
        expect(bucket990).toHaveTextContent("2");

        // SOS = 1, Recorder = 1, Uploaded = 1
        expect(
            screen.getByRole("button", { name: /^SOS filings/i }),
        ).toHaveTextContent("1");
        expect(
            screen.getByRole("button", { name: /^Recorder instruments/i }),
        ).toHaveTextContent("1");
        expect(
            screen.getByRole("button", { name: /^Uploaded/i }),
        ).toHaveTextContent("1");
    });

    it("shows the correct DETECT count (open NEW findings, dismissed excluded)", async () => {
        mockFetchSet({
            findings: [
                makeFinding({ severity: "CRITICAL", status: "NEW" }),
                makeFinding({ severity: "CRITICAL", status: "NEW" }),
                makeFinding({ severity: "HIGH", status: "NEW" }),
                makeFinding({ severity: "HIGH", status: "NEW" }),
                makeFinding({ severity: "HIGH", status: "NEW" }),
                makeFinding({ severity: "HIGH", status: "NEW" }),
                makeFinding({ severity: "MEDIUM", status: "DISMISSED" }),
                makeFinding({ severity: "HIGH", status: "DISMISSED" }),
                makeFinding({ severity: "HIGH", status: "DISMISSED" }),
                // CONFIRMED — counts toward total but not "open"
                makeFinding({ severity: "CRITICAL", status: "CONFIRMED" }),
            ],
        });

        renderWithProviders(<PhaseNavigator caseId="case-1" />);

        await waitFor(() => {
            // 10 total flags, 6 open
            expect(screen.getByText(/10 flags · 6 open/i)).toBeInTheDocument();
        });

        const critical = screen.getByRole("button", { name: /^Critical/i });
        expect(critical).toHaveTextContent("2");

        const high = screen.getByRole("button", { name: /^High/i });
        expect(high).toHaveTextContent("4");

        const medium = screen.getByRole("button", { name: /^Medium/i });
        expect(medium).toHaveTextContent("0");

        const dismissed = screen.getByRole("button", { name: /dismissed/i });
        expect(dismissed).toHaveTextContent("3");
    });

    it("fires onSubsetSelected with {phase, subset} when a sub-item is clicked", async () => {
        mockFetchSet({
            docs: [makeDoc({ doc_type: "IRS_990" })],
        });
        const onSubsetSelected = vi.fn();
        const user = userEvent.setup();

        renderWithProviders(
            <PhaseNavigator caseId="case-1" onSubsetSelected={onSubsetSelected} />,
        );

        const item = await screen.findByRole("button", { name: /^990s/i });
        await user.click(item);

        expect(onSubsetSelected).toHaveBeenCalledTimes(1);
        expect(onSubsetSelected).toHaveBeenCalledWith({
            phase: "ingest",
            subset: "990s",
        });
    });

    it("renders 0 counts (no crash) for an empty case", async () => {
        mockFetchSet({ docs: [], findings: [], jobs: [] });

        renderWithProviders(<PhaseNavigator caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/^0 docs$/)).toBeInTheDocument();
        });

        // Detect summary
        expect(screen.getByText(/0 flags · 0 open/i)).toBeInTheDocument();

        // Determine summary "0 / 0 confirmed"
        expect(screen.getByText(/0 \/ 0 confirmed/i)).toBeInTheDocument();

        // Each Ingest sub-row shows 0
        expect(screen.getByRole("button", { name: /^990s/i })).toHaveTextContent("0");
        expect(screen.getByRole("button", { name: /^Uploaded/i })).toHaveTextContent("0");

        // Investigate: no jobs run yet — but jobs response was non-null and empty,
        // so bucketJobs returns an empty Map → empty-state row appears.
        expect(screen.getByText(/no transforms run yet/i)).toBeInTheDocument();
    });

    it("buckets INVESTIGATE jobs by transform type and shows total", async () => {
        mockFetchSet({
            jobs: [
                makeJob({ job_type: "IRS_NAME_SEARCH" }),
                makeJob({ job_type: "IRS_NAME_SEARCH" }),
                makeJob({ job_type: "IRS_FETCH_XML" }),
                makeJob({ job_type: "OHIO_AOS" }),
                makeJob({ job_type: "COUNTY_PARCEL" }),
                makeJob({ job_type: "COUNTY_PARCEL" }),
            ],
        });

        renderWithProviders(<PhaseNavigator caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/6 transforms run/i)).toBeInTheDocument();
        });

        // IRS_NAME_SEARCH + IRS_FETCH_XML both collapse to "IRS TEOS" → 3
        expect(screen.getByRole("button", { name: /^IRS TEOS/i })).toHaveTextContent("3");
        expect(screen.getByRole("button", { name: /^Ohio AOS/i })).toHaveTextContent("1");
        expect(
            screen.getByRole("button", { name: /^County Recorder/i }),
        ).toHaveTextContent("2");
    });

    it("renders phase headers with '—' counts when all fetches fail", async () => {
        mockFetchSet({
            fail: { caseDetail: true, findings: true, jobs: true },
        });

        renderWithProviders(<PhaseNavigator caseId="case-1" />);

        // Wait for any phase to appear with the dash summary
        await waitFor(() => {
            // All four headers still present
            expect(screen.getByText("INGEST")).toBeInTheDocument();
            expect(screen.getByText("DETECT")).toBeInTheDocument();
            expect(screen.getByText("INVESTIGATE")).toBeInTheDocument();
            expect(screen.getByText("DETERMINE")).toBeInTheDocument();
        });

        // Summary text should be "—" for each phase header
        const dashes = screen.getAllByText("—");
        // 4 phase summaries + at least the sub-row dashes
        expect(dashes.length).toBeGreaterThanOrEqual(4);
    });
});
