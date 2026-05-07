/**
 * SearchView.tsx — Full-text search across cases, documents, angles, and entities.
 *
 * Vocabulary: Angles = Findings, Knots = Person/Organization nodes.
 * Banned strings: "Haiku", "Sonnet", "Claude", "AI assistant", "LLM", "GPT".
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchAll } from "../api";
import type { SearchResult } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<SearchResult["type"], string> = {
  case: "Cases",
  document: "Documents",
  signal: "Angles",
  entity: "Entities",
};

const TYPE_ORDER: SearchResult["type"][] = ["case", "entity", "document", "signal"];

function groupResults(results: SearchResult[]): Record<string, SearchResult[]> {
  const groups: Record<string, SearchResult[]> = {};
  for (const r of results) {
    if (!groups[r.type]) groups[r.type] = [];
    groups[r.type].push(r);
  }
  return groups;
}

// Simple highlight: wraps matched substrings in <mark>
function highlight(text: string, query: string): string {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
}

// ---------------------------------------------------------------------------
// SearchView
// ---------------------------------------------------------------------------

export default function SearchView() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchAll({ q: query.trim() });
        setResults(res.results);
        setSearched(true);
      } catch {
        setResults([]);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const grouped = groupResults(results);

  return (
    <div style={{ padding: "24px 32px", maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 24, fontWeight: 700 }}>Search</h1>

      {/* Search input */}
      <div style={{ position: "relative", marginBottom: 24 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cases, documents, angles, entities…"
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: 6,
            border: "1px solid var(--border, #2d2d4a)",
            background: "var(--surface-1, #1a1a2e)",
            color: "inherit",
            fontSize: 15,
            boxSizing: "border-box",
            outline: "none",
          }}
        />
        {loading && (
          <span
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 12,
              color: "var(--text-muted, #9ca3af)",
            }}
          >
            Searching…
          </span>
        )}
      </div>

      {/* Empty / idle state */}
      {!query.trim() && (
        <div className="empty-state">
          <p className="empty-state__title">Enter a search term</p>
          <p className="empty-state__body">
            Search across all cases, documents, angles, and entities.
          </p>
        </div>
      )}

      {/* No results state */}
      {searched && !loading && results.length === 0 && query.trim() && (
        <div className="empty-state">
          <p className="empty-state__title">No results for "{query}"</p>
          <p className="empty-state__body">Try a different search term or check spelling.</p>
        </div>
      )}

      {/* Results grouped by type */}
      {results.length > 0 && (
        <div>
          {TYPE_ORDER.filter((t) => grouped[t]?.length).map((type) => (
            <section key={type} style={{ marginBottom: 28 }}>
              <h2
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "var(--text-muted, #9ca3af)",
                  margin: "0 0 8px",
                }}
              >
                {TYPE_LABELS[type]} ({grouped[type].length})
              </h2>
              <div
                style={{
                  background: "var(--surface-1, #1a1a2e)",
                  border: "1px solid var(--border, #2d2d4a)",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                {grouped[type].map((result, i) => (
                  <div
                    key={result.id}
                    onClick={() => navigate(result.route)}
                    style={{
                      padding: "12px 16px",
                      cursor: "pointer",
                      borderTop:
                        i > 0 ? "1px solid var(--border, #2d2d4a)" : undefined,
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLDivElement).style.background =
                        "var(--surface-2, #0f0f1a)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLDivElement).style.background = "")
                    }
                  >
                    <div style={{ fontWeight: 500, fontSize: 14 }}>
                      <span
                        dangerouslySetInnerHTML={{
                          __html: highlight(result.title, query),
                        }}
                      />
                    </div>
                    {result.subtitle && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-muted, #9ca3af)",
                          marginTop: 2,
                        }}
                      >
                        {result.subtitle}
                        {result.case_name && result.type !== "case" && (
                          <span> · {result.case_name}</span>
                        )}
                      </div>
                    )}
                    {result.snippet && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-muted, #9ca3af)",
                          marginTop: 4,
                          fontStyle: "italic",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        dangerouslySetInnerHTML={{
                          __html: highlight(result.snippet, query),
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <style>{`
        mark {
          background: rgba(99, 102, 241, 0.3);
          color: inherit;
          border-radius: 2px;
          padding: 0 1px;
        }
      `}</style>
    </div>
  );
}
