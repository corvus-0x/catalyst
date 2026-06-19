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
    await expect(fetchApi("/api/x/")).rejects.toMatchObject({
      status: 400,
    });
    try {
      await fetchApi("/api/x/");
    } catch (e) {
      const err = e as ApiError;
      expect((err.body as any)?.errors?.gate?.unmet).toEqual(["narrative"]);
    }
  });
});
