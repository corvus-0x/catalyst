import { describe, expect, test } from "vitest";

import { findBannedTerms, scanSource } from "./check-banned-strings.mjs";

// Fixtures below are drawn from the REAL false-positive survey of frontend/src
// (grep for the banned list). The gate must pass on all of them while still
// catching genuine user-visible leaks.

describe("findBannedTerms — the precision-critical predicate", () => {
  test("flags a real user-visible model name", () => {
    expect(findBannedTerms("return <span>Powered by Claude</span>;")).toContain("Claude");
  });

  test("flags the 'AI assistant' phrase but never trips on bare 'AI' inside words", () => {
    expect(findBannedTerms('toast.error("AI assistant is offline")')).toContain("AI assistant");
    // 'domain', 'available', 'email' all contain "ai" — none may match.
    expect(findBannedTerms("const domain = available ? email : null;")).toEqual([]);
  });

  test("word boundaries: clearAllMocks / restoreAllMocks do NOT match 'LLM'", () => {
    // The exact repo false positive: case-insensitively, clearAl(lM)ocks ⊇ "llm".
    expect(findBannedTerms("beforeEach(() => vi.clearAllMocks());")).toEqual([]);
    expect(findBannedTerms("afterEach(() => vi.restoreAllMocks());")).toEqual([]);
  });

  test("flags a standalone LLM token", () => {
    expect(findBannedTerms("powered by an LLM model")).toContain("LLM");
  });

  test("is case-sensitive: brand-cased leaks flagged, lowercase identifiers ignored", () => {
    // Decision: match only the brand casing that actually ships in the UI.
    expect(findBannedTerms("label = 'Ask Claude'")).toContain("Claude");
    expect(findBannedTerms("import { claudeClient } from './api'")).toEqual([]);
  });
});

describe("scanSource — skips comment lines, reports line numbers", () => {
  test("does NOT flag banned words inside JSDoc/line comments", () => {
    const src = [
      ' * UI label: "Lead" (never "AI" or "Claude" — see CLAUDE.md vocabulary).',
      ' * BANNED UI STRINGS: "Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM", "GPT"',
      '// never show "Claude"',
    ].join("\n");
    expect(scanSource(src)).toEqual([]);
  });

  test("flags a banned word in real (non-comment) JSX and reports its line", () => {
    const src = ["function Panel() {", "  return <div>Ask Claude</div>;", "}"].join("\n");
    const hits = scanSource(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].lineNumber).toBe(2);
    expect(hits[0].terms).toContain("Claude");
  });
});
