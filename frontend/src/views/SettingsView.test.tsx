import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsView from "./SettingsView";
import RouteErrorBoundary from "../components/RouteErrorBoundary";

vi.mock("../api", () => ({
  fetchSosCsvStatus: vi.fn().mockResolvedValue({
    files: [
      { filename: "WI0070R.TXT", report_type: "NONPROFIT_CORP", exists: true,
        uploaded_at: "2026-07-01T00:00:00Z", days_old: 13, size_bytes: 1024 },
      { filename: "WI0100R.TXT", report_type: "DOMESTIC_LLC", exists: false,
        uploaded_at: null, days_old: null, size_bytes: null },
    ],
  }),
  uploadSosCsv: vi.fn(),
}));

describe("SettingsView", () => {
  it("renders the real /api/admin/sos-csv-status/ shape without crashing", async () => {
    render(<SettingsView />);
    const fileList = await screen.findByTestId("sos-status-files");
    await waitFor(() => expect(within(fileList).getByText("WI0070R.TXT")).toBeInTheDocument());
    expect(screen.getByText(/1 of 2 expected files uploaded/i)).toBeInTheDocument();
    expect(within(fileList).getByText("WI0100R.TXT")).toBeInTheDocument();
  });

  it("error boundary catches a crashing child", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = () => {
      throw new Error("boom");
    };
    render(
      <RouteErrorBoundary>
        <Boom />
      </RouteErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
