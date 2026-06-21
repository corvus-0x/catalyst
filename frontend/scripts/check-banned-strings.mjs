#!/usr/bin/env node
/**
 * Banned-strings gate — fails if any user-visible source string exposes a
 * model/vendor name we never show in the UI (CLAUDE.md "Banned strings").
 *
 * Two precision rules learned from the false-positive survey of frontend/src:
 *   1. Word-boundary matching — `clearAllMocks` must NOT match "LLM".
 *   2. Skip comment lines      — JSDoc that documents the rule must not trip it.
 *
 * Pure logic (findBannedTerms / scanSource) is unit-tested in
 * check-banned-strings.test.mjs; the CLI wrapper walks the files passed as args
 * and sets a non-zero exit code so a pre-commit hook or CI step can gate on it.
 *
 * Known limitation (first-70%): a banned word inside a *trailing* inline
 * comment (`foo(); // ...Claude...`) is not exempt — only whole comment lines
 * are skipped. Rare in this codebase; revisit if it bites.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Exact banned list from CLAUDE.md. Note: "AI assistant" (phrase), not bare "AI". */
export const BANNED_TERMS = ["Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM", "GPT"];

// One compiled pattern, built from the list so the list stays the single source
// of truth. \b...\b = word boundaries (kills the clearAllMocks→"LLM" trap).
// Case-sensitive on purpose: UI leaks ship brand-cased; lowercase identifiers
// (a stray `claudeClient`) shouldn't trip the gate. The "g" flag returns every hit.
const BANNED_PATTERN = new RegExp(`\\b(${BANNED_TERMS.join("|")})\\b`, "g");

/**
 * Return the banned terms appearing in a single line of source.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ TODO(tyler): implement this predicate — it is the whole point of the gate.│
 * └─────────────────────────────────────────────────────────────────────────┘
 * Requirements pinned by the tests:
 *   • match each BANNED_TERMS entry on WORD BOUNDARIES (so "clearAllMocks"
 *     does not match "LLM", and "domain"/"available" never match anything)
 *   • return the matched term(s); [] when the line is clean
 * Design decision left to you: case sensitivity. "Claude" is a proper noun, but
 * could a leak be lowercase? Encode your choice in the regex AND add a test for it.
 */
export function findBannedTerms(line) {
  const matches = line.match(BANNED_PATTERN);
  // match() with a /g pattern returns every hit (or null). Dedupe so a line
  // with two "Claude"s reports the term once.
  return matches ? [...new Set(matches)] : [];
}

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

/** Scan whole-file source; returns [{ lineNumber, line, terms }] for each violation. */
export function scanSource(source) {
  const hits = [];
  source.split(/\r?\n/).forEach((line, i) => {
    if (COMMENT_LINE.test(line)) return; // exempt comment lines
    const terms = findBannedTerms(line);
    if (terms.length) hits.push({ lineNumber: i + 1, line: line.trim(), terms });
  });
  return hits;
}

/** Recursively collect every .ts/.tsx file under a directory. */
function collectSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// CLI entrypoint: `node check-banned-strings.mjs [file...]`.
// With no args it scans all of src/ — so the same command works on Windows,
// CI, and a git hook with zero shell glob tricks.
const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  const args = process.argv.slice(2);
  const files = args.length ? args : collectSourceFiles("src");
  let failed = false;
  for (const file of files) {
    for (const h of scanSource(readFileSync(file, "utf8"))) {
      failed = true;
      console.error(`${file}:${h.lineNumber}  banned [${h.terms.join(", ")}]  →  ${h.line}`);
    }
  }
  if (failed) {
    console.error(
      "\nBanned UI strings found (CLAUDE.md). Use the vocabulary: Lead / Intake / Thread.",
    );
    process.exit(1);
  }
}
