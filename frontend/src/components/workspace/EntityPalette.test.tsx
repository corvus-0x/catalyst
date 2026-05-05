/**
 * EntityPalette tests — Zone 2 §7.2.
 *
 * Pattern: TooltipProvider wrap + userEvent.click for Radix portal-rendered
 * dialogs. Modal portals into document.body so we query through `screen`.
 */
import { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityPalette, orderCategories, persistRecent, loadRecent } from "./EntityPalette";
import { TooltipProvider } from "../ui/Tooltip";

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

interface FetchResponse {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
    headers: Headers;
}

function mockFetchOnce(body: unknown, status = 200): void {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: status < 400,
        status,
        json: async () => body,
        headers: new Headers({ "content-type": "application/json" }),
    } satisfies FetchResponse);
}

/* ───── Pure helpers ───── */

describe("orderCategories", () => {
    const categories = [
        { kind: "person" as const, label: "Person" },
        { kind: "organization" as const, label: "Organization" },
        { kind: "property" as const, label: "Property" },
        { kind: "financial_instrument" as const, label: "Financial instrument" },
        { kind: "document" as const, label: "Document", disabled: true },
    ];

    it("alphabetizes when no recent and pushes disabled to bottom", () => {
        const out = orderCategories(categories, []);
        expect(out.map((c) => c.kind)).toEqual([
            "financial_instrument",
            "organization",
            "person",
            "property",
            "document",
        ]);
    });

    it("floats recent kinds to the top in stored order", () => {
        const out = orderCategories(categories, ["organization", "person"]);
        expect(out.map((c) => c.kind).slice(0, 2)).toEqual(["organization", "person"]);
    });

    it("never promotes a disabled category even if it appears in recent", () => {
        const out = orderCategories(categories, ["document"]);
        expect(out[0].kind).not.toBe("document");
    });
});

describe("persistRecent / loadRecent", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("stores a single click and reads it back", () => {
        const next = persistRecent("case-A", "organization");
        expect(next).toEqual(["organization"]);
        expect(loadRecent("case-A")).toEqual(["organization"]);
    });

    it("dedups so the last-clicked kind is at index 0", () => {
        persistRecent("case-A", "person");
        persistRecent("case-A", "organization");
        persistRecent("case-A", "person");
        expect(loadRecent("case-A")).toEqual(["person", "organization"]);
    });

    it("scopes by case id", () => {
        persistRecent("case-A", "person");
        persistRecent("case-B", "property");
        expect(loadRecent("case-A")).toEqual(["person"]);
        expect(loadRecent("case-B")).toEqual(["property"]);
    });
});

/* ───── Component ───── */

describe("EntityPalette", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders all five category buttons", () => {
        renderWithProviders(<EntityPalette caseId="case-1" />);
        expect(screen.getByRole("button", { name: /add person/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /add organization/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /add property/i })).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /add financial instrument/i }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /add document/i })).toBeInTheDocument();
    });

    it("disables the Document button (upload routes through Documents tab)", () => {
        renderWithProviders(<EntityPalette caseId="case-1" />);
        const docBtn = screen.getByRole("button", { name: /add document/i });
        expect(docBtn).toBeDisabled();
    });

    it("opens the Person modal with name + aliases + DOB fields when Person is clicked", async () => {
        const user = userEvent.setup();
        renderWithProviders(<EntityPalette caseId="case-1" />);
        await user.click(screen.getByRole("button", { name: /add person/i }));

        await waitFor(() => {
            expect(screen.getByRole("dialog")).toBeInTheDocument();
        });
        // Fields by their labels
        expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/aliases/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument();
    });

    it("shows an inline error when Person form is submitted with no name", async () => {
        const user = userEvent.setup();
        renderWithProviders(<EntityPalette caseId="case-1" />);
        await user.click(screen.getByRole("button", { name: /add person/i }));

        await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

        await user.click(screen.getByRole("button", { name: /add to case/i }));

        await waitFor(() => {
            expect(screen.getByRole("alert")).toHaveTextContent(/name is required/i);
        });
        // Modal is still open
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("fires onCreated and closes the modal on a successful Organization create", async () => {
        const user = userEvent.setup();
        const onCreated = vi.fn();
        // First mock = organization add-to-case POST
        mockFetchOnce({
            created: "organization",
            entity: { name: "Acme Charity" },
            duplicate: false,
        });

        renderWithProviders(<EntityPalette caseId="case-1" onCreated={onCreated} />);
        await user.click(screen.getByRole("button", { name: /add organization/i }));
        await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

        await user.type(screen.getByLabelText(/^name/i), "Acme Charity");
        await user.click(screen.getByRole("button", { name: /add to case/i }));

        await waitFor(() => expect(onCreated).toHaveBeenCalled());

        // Modal closed
        await waitFor(() => {
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        });

        // Verify it hit the add-to-case endpoint with the right shape
        const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
        const addToCase = calls.find(([url]) => String(url).includes("/research/add-to-case/"));
        expect(addToCase).toBeDefined();
        const body = JSON.parse(addToCase![1].body as string);
        expect(body.source).toBe("ohio-sos");
        expect(body.data.business_name).toBe("Acme Charity");
    });

    it("re-uses the modal cleanly when switching from Organization to Property", async () => {
        const user = userEvent.setup();
        renderWithProviders(<EntityPalette caseId="case-1" />);

        // Open Organization modal first, type something, close it.
        await user.click(screen.getByRole("button", { name: /add organization/i }));
        await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
        await user.type(screen.getByLabelText(/^name/i), "Discarded Org");

        await user.click(screen.getByRole("button", { name: /^cancel$/i }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

        // Now open Property — modal should be fresh, with Address as the first field.
        await user.click(screen.getByRole("button", { name: /add property/i }));
        await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

        // Property dialog has Address, no leftover Organization Name field
        expect(screen.getByLabelText(/address/i)).toBeInTheDocument();
        // Property's first input is empty (no stale "Discarded Org" string)
        expect((screen.getByLabelText(/address/i) as HTMLInputElement).value).toBe("");
        // Property dialog title visible
        expect(screen.getByRole("heading", { name: /add property/i })).toBeInTheDocument();
    });

    it("re-orders the palette so the most recently used category sits at the top", async () => {
        const user = userEvent.setup();
        // Mock the org create POST so the click flow can complete cleanly.
        mockFetchOnce({
            created: "organization",
            entity: { name: "Foo" },
            duplicate: false,
        });

        const { container, rerender } = renderWithProviders(<EntityPalette caseId="case-1" />);

        // Before any clicks, default alphabetical order means Financial instrument is first.
        const buttonsBefore = Array.from(
            container.querySelectorAll('button[aria-label^="Add "]'),
        ) as HTMLButtonElement[];
        expect(buttonsBefore[0]).toHaveAttribute("aria-label", "Add Financial instrument");

        // Click Organization, fill name, submit -> persistRecent fires.
        await user.click(screen.getByRole("button", { name: /add organization/i }));
        await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
        await user.type(screen.getByLabelText(/^name/i), "Foo");
        await user.click(screen.getByRole("button", { name: /add to case/i }));

        await waitFor(() => {
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        });

        // localStorage should now record organization as recent.
        expect(loadRecent("case-1")).toEqual(["organization"]);

        // Force a remount to re-read localStorage on a fresh render.
        rerender(
            <TooltipProvider>
                <EntityPalette caseId="case-1" key="remount" />
            </TooltipProvider>,
        );

        const buttonsAfter = Array.from(
            container.querySelectorAll('button[aria-label^="Add "]'),
        ) as HTMLButtonElement[];
        expect(buttonsAfter[0]).toHaveAttribute("aria-label", "Add Organization");
    });
});
