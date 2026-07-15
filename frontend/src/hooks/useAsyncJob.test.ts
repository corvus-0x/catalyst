import { act, renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAsyncJob } from "./useAsyncJob";

const fetchJobMock = vi.fn();

vi.mock("../api", () => ({
  fetchJob: (...a: unknown[]) => fetchJobMock(...a),
}));

beforeEach(() => {
  fetchJobMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAsyncJob poll cap", () => {
  it("stops polling and reports FAILED after ~3 minutes stuck at QUEUED", async () => {
    vi.useFakeTimers();
    fetchJobMock.mockResolvedValue({
      id: "job-1",
      status: "QUEUED",
      result: null,
      error_message: null,
    });

    const { result } = renderHook(() => useAsyncJob());

    await act(async () => {
      await result.current.run(async () => ({
        job_id: "job-1",
        status_url: "/api/jobs/job-1/",
      }));
    });

    expect(result.current.status).toBe("QUEUED");

    // Advance well past the 90-poll (3 minute) cap.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000 * 91);
    });

    expect(result.current.status).toBe("FAILED");
    expect(result.current.error).toBe(
      "Still queued after several minutes — the worker may be busy. Check back shortly."
    );

    const callsAtCap = fetchJobMock.mock.calls.length;

    // Polling must actually have stopped — no further fetchJob calls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000 * 5);
    });
    expect(fetchJobMock.mock.calls.length).toBe(callsAtCap);
  });

  it("boundary: still QUEUED just before the cap, FAILED with STUCK_JOB_MESSAGE right at the cap", async () => {
    vi.useFakeTimers();
    fetchJobMock.mockResolvedValue({
      id: "job-3",
      status: "QUEUED",
      result: null,
      error_message: null,
    });

    const { result } = renderHook(() => useAsyncJob());

    await act(async () => {
      await result.current.run(async () => ({
        job_id: "job-3",
        status_url: "/api/jobs/job-3/",
      }));
    });

    // Advance to exactly one poll short of the cap (MAX_POLLS - 1 = 89 polls).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000 * 89);
    });
    expect(result.current.status).toBe("QUEUED");

    // One more interval crosses the cap (90th poll).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe("FAILED");
    expect(result.current.error).toBe(
      "Still queued after several minutes — the worker may be busy. Check back shortly."
    );
  });

  it("reports a network-unreachable message (not the worker-busy one) if every poll rejects", async () => {
    vi.useFakeTimers();
    fetchJobMock.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useAsyncJob());

    await act(async () => {
      await result.current.run(async () => ({
        job_id: "job-4",
        status_url: "/api/jobs/job-4/",
      }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000 * 91);
    });

    expect(result.current.status).toBe("FAILED");
    expect(result.current.error).toBe(
      "Couldn't reach the server — check your connection and try again."
    );
  });

  it("does not fail early if the job resolves before the cap", async () => {
    vi.useFakeTimers();
    fetchJobMock.mockResolvedValue({
      id: "job-2",
      status: "SUCCESS",
      result: { ok: true },
      error_message: null,
    });

    const { result } = renderHook(() => useAsyncJob());

    await act(async () => {
      await result.current.run(async () => ({
        job_id: "job-2",
        status_url: "/api/jobs/job-2/",
      }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.status).toBe("SUCCESS");
    expect(result.current.result).toEqual({ ok: true });
  });
});
