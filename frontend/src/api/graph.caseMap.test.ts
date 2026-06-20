import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchCaseMap } from "./graph";

afterEach(() => vi.restoreAllMocks());

describe("fetchCaseMap", () => {
  it("GETs the /case-map/ endpoint and returns the parsed body", async () => {
    const body = {
      case_id: "c1",
      nodes: [],
      edges: [],
      stats: {
        subject_count: 0, edge_count: 0,
        by_level: { observed: 0, documented: 0, repeated: 0, material: 0 },
        material_edge_count: 0, handoff_edge_count: 0, generated_at: "2026-06-19T00:00:00Z",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    );
    const result = await fetchCaseMap("c1");
    expect(result.case_id).toBe("c1");
    expect(result.stats.by_level.material).toBe(0);
  });
});
