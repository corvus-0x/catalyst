import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchApi, ApiError } from "./base";

afterEach(() => vi.restoreAllMocks());

describe("fetchApi error body", () => {
  it("attaches the parsed JSON body to ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ errors: { gate: { unmet: ["narrative"] } } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    // Single rejected promise — assert status AND body together so the body
    // check can never be silently skipped by an unexpected resolve.
    const err = await fetchApi("/api/x/").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect(((err as ApiError).body as any)?.errors?.gate?.unmet).toEqual(["narrative"]);
  });
});
