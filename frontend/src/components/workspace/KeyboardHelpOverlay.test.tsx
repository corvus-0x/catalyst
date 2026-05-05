/**
 * KeyboardHelpOverlay tests — controlled Radix dialog wrapping the
 * project's Dialog primitive. Wrapped in TooltipProvider in case any
 * descendant renders a Tooltip.
 */
import { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KeyboardHelpOverlay } from "./KeyboardHelpOverlay";
import { TooltipProvider } from "../ui/Tooltip";

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("KeyboardHelpOverlay", () => {
    it("renders shortcut sections when open", () => {
        renderWithProviders(
            <KeyboardHelpOverlay open={true} onOpenChange={vi.fn()} />,
        );
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByText(/keyboard shortcuts/i)).toBeInTheDocument();
        // Section headers
        expect(screen.getByText(/^global$/i)).toBeInTheDocument();
        expect(screen.getByText(/^layout$/i)).toBeInTheDocument();
        expect(screen.getByText(/^graph$/i)).toBeInTheDocument();
    });

    it("renders V / S / L graph mode rows", () => {
        renderWithProviders(
            <KeyboardHelpOverlay open={true} onOpenChange={vi.fn()} />,
        );
        // Each is rendered as a <kbd>.
        const kbds = screen.getAllByText(/^[VSL]$/);
        const labels = kbds.map((el) => el.textContent);
        expect(labels).toEqual(expect.arrayContaining(["V", "S", "L"]));
        // Descriptions present
        expect(screen.getByText(/switch to pan mode/i)).toBeInTheDocument();
        expect(screen.getByText(/switch to select mode/i)).toBeInTheDocument();
        expect(screen.getByText(/switch to link mode/i)).toBeInTheDocument();
    });

    it("renders modifier-based shortcut rows (toggle dock + view panes)", () => {
        renderWithProviders(
            <KeyboardHelpOverlay open={true} onOpenChange={vi.fn()} />,
        );
        expect(screen.getByText(/toggle bottom dock/i)).toBeInTheDocument();
        expect(screen.getByText(/toggle layout lock/i)).toBeInTheDocument();
        expect(screen.getByText(/view pane: graph/i)).toBeInTheDocument();
        expect(screen.getByText(/view pane: 990/i)).toBeInTheDocument();
        expect(screen.getByText(/view pane: financials/i)).toBeInTheDocument();
        expect(screen.getByText(/view pane: package/i)).toBeInTheDocument();
    });

    it("does not render dialog content when open is false", () => {
        renderWithProviders(
            <KeyboardHelpOverlay open={false} onOpenChange={vi.fn()} />,
        );
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("clicking the close button fires onOpenChange(false)", async () => {
        const onOpenChange = vi.fn();
        const user = userEvent.setup();
        renderWithProviders(
            <KeyboardHelpOverlay open={true} onOpenChange={onOpenChange} />,
        );
        const closeBtn = screen.getByRole("button", { name: /close/i });
        await user.click(closeBtn);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
