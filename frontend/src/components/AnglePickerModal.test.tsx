import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AnglePickerModal from "./AnglePickerModal";

const fetchAnglesMock = vi.fn();
vi.mock("../api", () => ({
  fetchAngles: (...args: unknown[]) => fetchAnglesMock(...args),
}));

beforeEach(() => {
  fetchAnglesMock.mockReset();
  fetchAnglesMock.mockResolvedValue({
    results: [
      { id: "ang-1", title: "Insider swap" },
      { id: "ang-2", title: "False disclosure" },
    ],
    count: 2,
  });
});

describe("AnglePickerModal", () => {
  it("renders the new-angle option first and lists existing angles", async () => {
    render(<AnglePickerModal caseId="c1" open onClose={() => {}} onPick={async () => true} />);
    expect(await screen.findByText(/\+ New Angle from this/i)).toBeInTheDocument();
    expect(screen.getByText("Insider swap")).toBeInTheDocument();
    expect(screen.getByText("False disclosure")).toBeInTheDocument();
  });

  it("calls onPick(null) for new and onPick(id) for an existing angle", async () => {
    const onPick = vi.fn().mockResolvedValue(true);
    render(<AnglePickerModal caseId="c1" open onClose={() => {}} onPick={onPick} />);
    await userEvent.click(await screen.findByText(/\+ New Angle from this/i));
    expect(onPick).toHaveBeenCalledWith(null);
    await userEvent.click(screen.getByText("Insider swap"));
    expect(onPick).toHaveBeenCalledWith("ang-1");
  });

  it("does not fetch when closed", async () => {
    render(<AnglePickerModal caseId="c1" open={false} onClose={() => {}} onPick={async () => true} />);
    await waitFor(() => expect(fetchAnglesMock).not.toHaveBeenCalled());
  });

  it("stays open when onPick resolves false (failed cite)", async () => {
    const onClose = vi.fn();
    const onPick = vi.fn().mockResolvedValue(false);
    render(<AnglePickerModal caseId="c1" open onClose={onClose} onPick={onPick} />);
    await userEvent.click(await screen.findByText("Insider swap"));
    expect(onPick).toHaveBeenCalledWith("ang-1");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when onPick resolves true", async () => {
    const onClose = vi.fn();
    render(<AnglePickerModal caseId="c1" open onClose={onClose} onPick={async () => true} />);
    await userEvent.click(await screen.findByText("Insider swap"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error with retry when the angle load fails, and refetches on retry", async () => {
    fetchAnglesMock.mockReset();
    fetchAnglesMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ results: [{ id: "ang-1", title: "Insider swap" }], count: 1 });
    render(<AnglePickerModal caseId="c1" open onClose={() => {}} onPick={async () => true} />);
    // A failed load surfaces a distinct error, NOT the empty-case message.
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn.t load angles/i);
    expect(screen.queryByText("No angles yet.")).not.toBeInTheDocument();
    // Retry refetches and shows the angles; the error clears.
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Insider swap")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
