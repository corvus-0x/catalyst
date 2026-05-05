import { ReactElement } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentTablePanel } from "./DocumentTablePanel";
import { TooltipProvider } from "../ui/Tooltip";
import { DocumentItem } from "../../types";

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function doc(partial: Partial<DocumentItem> = {}): DocumentItem {
    return {
        id: "doc-1",
        filename: "irs_990_2024.pdf",
        display_name: "IRS 990 (2024)",
        file_path: "/media/docs/irs_990_2024.pdf",
        sha256_hash: "a3f7b29ce5dd5b2e4a1c6f88d9a4b1c7e2f3d6a5b8c9d0e1f2a3b4c5d6e7f8a9",
        file_size: 234567,
        doc_type: "IRS_990",
        is_generated: false,
        doc_subtype: "",
        source_url: null,
        ocr_status: "COMPLETE",
        uploaded_at: "2026-04-21T15:00:00Z",
        updated_at: "2026-04-21T15:01:00Z",
        ...partial,
    };
}

function mockCaseDetailFetch(documents: DocumentItem[]) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
            id: "case-1",
            name: "Demo",
            status: "ACTIVE",
            notes: "",
            referral_ref: "",
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-21T15:00:00Z",
            finding_count: 0,
            documents,
        }),
        headers: new Headers({ "content-type": "application/json" }),
    });
}

function mockCaseDetailFails(message = "boom") {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error(message));
}

describe("DocumentTablePanel", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders rows for fetched documents with display_name in the filename column", async () => {
        mockCaseDetailFetch([
            doc({ id: "a", display_name: "Annual Report 2024", filename: "ar.pdf" }),
            doc({ id: "b", display_name: "Articles of Incorporation", filename: "ai.pdf" }),
        ]);
        renderWithProviders(<DocumentTablePanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("Annual Report 2024")).toBeInTheDocument();
            expect(screen.getByText("Articles of Incorporation")).toBeInTheDocument();
        });
    });

    it("calls onLoaded with the row count after a successful fetch", async () => {
        mockCaseDetailFetch([doc({ id: "a" }), doc({ id: "b" })]);
        const onLoaded = vi.fn();

        renderWithProviders(<DocumentTablePanel caseId="case-1" onLoaded={onLoaded} />);
        await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(2));
    });

    it("renders the empty state when there are no documents", async () => {
        mockCaseDetailFetch([]);
        renderWithProviders(<DocumentTablePanel caseId="case-1" />);
        await waitFor(() => {
            expect(screen.getByText(/no documents uploaded yet/i)).toBeInTheDocument();
        });
    });

    it("renders an error state with retry when fetch fails", async () => {
        mockCaseDetailFails("network down");
        renderWithProviders(<DocumentTablePanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/network down/i)).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    it("renders a color-coded OCR status chip", async () => {
        mockCaseDetailFetch([doc({ id: "a", ocr_status: "PENDING" })]);
        renderWithProviders(<DocumentTablePanel caseId="case-1" />);

        const chip = await screen.findByText("PENDING");
        // The chip's class list should include the pending tone style.
        expect(chip.className).toMatch(/ocr_pending/);
    });

    it("invokes onFocusDocument with the original row when a row is clicked", async () => {
        const target = doc({ id: "x", display_name: "click target" });
        mockCaseDetailFetch([target]);
        const onFocusDocument = vi.fn();

        renderWithProviders(
            <DocumentTablePanel caseId="case-1" onFocusDocument={onFocusDocument} />,
        );

        await waitFor(() => screen.getByText("click target"));
        fireEvent.click(screen.getByText("click target"));

        expect(onFocusDocument).toHaveBeenCalledTimes(1);
        expect(onFocusDocument.mock.calls[0][0].id).toBe("x");
    });

    it("copies SHA-256 to clipboard when the hash cell is clicked", async () => {
        mockCaseDetailFetch([
            doc({
                id: "a",
                sha256_hash: "deadbeefcafebabe1234567890abcdef0123456789abcdef0123456789abcdef",
            }),
        ]);
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });

        renderWithProviders(<DocumentTablePanel caseId="case-1" />);

        const hashBtn = await screen.findByLabelText(/copy sha-256 hash/i);
        fireEvent.click(hashBtn);

        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith(
                "deadbeefcafebabe1234567890abcdef0123456789abcdef0123456789abcdef",
            );
        });
    });

    it("does not invoke onFocusDocument when the hash copy button is clicked", async () => {
        mockCaseDetailFetch([doc({ id: "x", sha256_hash: "ab".repeat(32) })]);
        const onFocusDocument = vi.fn();
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue(undefined) },
        });

        renderWithProviders(
            <DocumentTablePanel caseId="case-1" onFocusDocument={onFocusDocument} />,
        );

        const hashBtn = await screen.findByLabelText(/copy sha-256 hash/i);
        fireEvent.click(hashBtn);

        expect(onFocusDocument).not.toHaveBeenCalled();
    });
});
