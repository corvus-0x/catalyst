/**
 * useAsyncJob — polls a backend async job until it reaches SUCCESS or FAILED.
 *
 * Usage pattern (Research tab):
 *   const job = useAsyncJob<IrsSearchJobResult>();
 *   await job.run(() => searchIrs(caseId, params));   // POST → 202, then polls
 *   // job.status: "idle" | "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED"
 *   // job.result: TResult | null (populated on SUCCESS)
 *
 * Reattach-on-mount (resume a job started in a previous session):
 *   const jobs = await fetchCaseJobs(caseId, 5);
 *   const inFlight = jobs.results.find(j => j.status === "QUEUED" || j.status === "RUNNING");
 *   if (inFlight) job.reattach(inFlight);
 */

import { useEffect, useRef, useState } from "react";
import { fetchJob } from "../api";
import type { AsyncJobEnqueuedResponse, JobStatus, SearchJob } from "../types";

export interface AsyncJobState<TResult> {
  status: JobStatus | "idle";
  result: TResult | null;
  error: string | null;
  jobId: string | null;
  run: (postFn: () => Promise<AsyncJobEnqueuedResponse>) => Promise<void>;
  reattach: (job: SearchJob) => void;
  reset: () => void;
}

export function useAsyncJob<TResult = unknown>(): AsyncJobState<TResult> {
  const [status, setStatus] = useState<JobStatus | "idle">("idle");
  const [result, setResult] = useState<TResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function startPolling(id: string) {
    stopPolling();
    intervalRef.current = setInterval(async () => {
      try {
        const job = await fetchJob(id);
        setStatus(job.status);
        if (job.status === "SUCCESS") {
          setResult(job.result as TResult);
          stopPolling();
        } else if (job.status === "FAILED") {
          setError(job.error_message ?? "Job failed");
          stopPolling();
        }
      } catch {
        // Network blip — keep polling until status resolves
      }
    }, 2000);
  }

  async function run(postFn: () => Promise<AsyncJobEnqueuedResponse>) {
    stopPolling();
    setStatus("QUEUED");
    setResult(null);
    setError(null);
    setJobId(null);
    try {
      const envelope = await postFn();
      setJobId(envelope.job_id);
      setStatus("QUEUED");
      startPolling(envelope.job_id);
    } catch (err) {
      setStatus("FAILED");
      setError(err instanceof Error ? err.message : "Failed to start job");
    }
  }

  function reattach(job: SearchJob) {
    setJobId(job.id);
    setStatus(job.status);
    if (job.status === "SUCCESS") {
      setResult(job.result as TResult);
    } else if (job.status === "FAILED") {
      setError(job.error_message ?? "Job failed");
    } else {
      startPolling(job.id);
    }
  }

  function reset() {
    stopPolling();
    setStatus("idle");
    setResult(null);
    setError(null);
    setJobId(null);
  }

  // Stop polling on unmount — do NOT cancel the server-side job
  useEffect(() => () => stopPolling(), []);

  return { status, result, error, jobId, run, reattach, reset };
}
