/**
 * SettingsView.tsx — Application settings: Ohio SOS CSV upload and system info.
 *
 * Vocabulary: Intake = document extraction pipeline (never show "Haiku" or "AI").
 * Banned strings: "Haiku", "Sonnet", "Claude", "AI assistant", "LLM", "GPT".
 */

import { useEffect, useRef, useState } from "react";
import { uploadSosCsv, fetchSosCsvStatus } from "../api";
import type { SosCsvStatusResponse } from "../types";

// ---------------------------------------------------------------------------
// SOS CSV Upload section
// ---------------------------------------------------------------------------

function SosCsvSection() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<SosCsvStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  async function loadStatus() {
    setStatusLoading(true);
    try {
      const res = await fetchSosCsvStatus();
      setStatus(res as SosCsvStatusResponse);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await uploadSosCsv(formData);
      setFeedback({ type: "success", message: `"${file.name}" uploaded successfully.` });
      await loadStatus();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Upload failed. Check the file and try again.",
      });
    } finally {
      setUploading(false);
      // Reset file input so the same file can be re-uploaded if needed
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <section
      style={{
        background: "var(--surface-1, #1a1a2e)",
        border: "1px solid var(--border, #2d2d4a)",
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600 }}>
        Ohio SOS CSV data
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-muted, #9ca3af)" }}>
        The Ohio Secretary of State connector searches from locally uploaded CSV files.
        Download the monthly bulk data files from{" "}
        <a
          href="https://publicfiles.ohiosos.gov"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--primary, #6366f1)" }}
        >
          publicfiles.ohiosos.gov
        </a>
        . You need <strong style={{ color: "inherit" }}>WI0070R.TXT</strong> (Nonprofit Corps)
        and <strong style={{ color: "inherit" }}>WI0100R.TXT</strong> (Domestic LLCs).
        Published on the second Saturday of each month.
      </p>

      {/* Status table */}
      {statusLoading ? (
        <div className="skeleton" style={{ height: 80, borderRadius: 6, marginBottom: 16 }} />
      ) : status ? (
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: status.all_present ? "#22c55e" : "#f59e0b",
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {status.all_present
                ? "All expected files are present."
                : `${status.uploaded_files.length} of ${status.expected_files.length} expected files uploaded.`}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gap: 4,
              fontSize: 12,
            }}
          >
            {status.expected_files.map((fname) => {
              const uploaded = status.uploaded_files.includes(fname);
              return (
                <div key={fname} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: uploaded ? "#22c55e" : "#9ca3af" }}>
                    {uploaded ? "✓" : "○"}
                  </span>
                  <span style={{ color: uploaded ? "inherit" : "var(--text-muted, #9ca3af)" }}>
                    {fname}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: "#ef4444", marginBottom: 16 }}>
          Could not load CSV status. Check backend connection.
        </p>
      )}

      {/* Upload control */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={handleUpload}
          disabled={uploading}
        />
        <button
          className="btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "Upload CSV file"}
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted, #9ca3af)" }}>
          Accepts .csv files from Ohio SOS public data portal
        </span>
      </div>

      {/* Feedback */}
      {feedback && (
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 13,
            color: feedback.type === "success" ? "#22c55e" : "#ef4444",
          }}
        >
          {feedback.message}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// About section
// ---------------------------------------------------------------------------

function AboutSection() {
  return (
    <section
      style={{
        background: "var(--surface-1, #1a1a2e)",
        border: "1px solid var(--border, #2d2d4a)",
        borderRadius: 8,
        padding: 20,
      }}
    >
      <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600 }}>About</h2>
      <dl
        style={{
          margin: 0,
          display: "grid",
          gridTemplateColumns: "140px 1fr",
          gap: "8px 16px",
          fontSize: 13,
        }}
      >
        <dt style={{ color: "var(--text-muted, #9ca3af)", fontWeight: 500 }}>Platform</dt>
        <dd style={{ margin: 0 }}>Catalyst Investigation Platform</dd>

        <dt style={{ color: "var(--text-muted, #9ca3af)", fontWeight: 500 }}>Purpose</dt>
        <dd style={{ margin: 0 }}>
          Referral packaging for citizen investigators handing off to professionals with subpoena
          power.
        </dd>

        <dt style={{ color: "var(--text-muted, #9ca3af)", fontWeight: 500 }}>Backend status</dt>
        <dd style={{ margin: 0 }}>
          Check the Railway dashboard for backend health and deployment status.
        </dd>

        <dt style={{ color: "var(--text-muted, #9ca3af)", fontWeight: 500 }}>Data sources</dt>
        <dd style={{ margin: 0 }}>
          IRS TEOS 990 XML, Ohio SOS (local CSV), Ohio AOS, County Recorder (88 counties)
        </dd>
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SettingsView
// ---------------------------------------------------------------------------

export default function SettingsView() {
  return (
    <div style={{ padding: "24px 32px", maxWidth: 680, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 24px", fontSize: 24, fontWeight: 700 }}>Settings</h1>
      <SosCsvSection />
      <AboutSection />
    </div>
  );
}
