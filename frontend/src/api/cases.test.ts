import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createElement,
  reorderElements,
  addCitation,
  updateElement,
  deleteElement,
  removeCitation,
} from "./cases";

describe("thread element clients", () => {
  beforeEach(() => {
    // Provide a CSRF cookie so ensureCsrfCookie() returns early without an
    // extra /api/csrf/ fetch -- keeps mock.calls[0] as the real API call.
    vi.stubGlobal("document", {
      ...globalThis.document,
      cookie: "csrftoken=testcsrf",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ id: "1", element_type: "ASSERTION" }), { status: 200 }),
      ),
    );
  });

  it("createElement POSTs to the finding's elements collection", async () => {
    await createElement("case1", "find1", { element_type: "ASSERTION", text: "x" });
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/api/cases/case1/findings/find1/elements/");
    expect(opts.method).toBe("POST");
  });

  it("reorderElements POSTs ordered_ids to the reorder endpoint", async () => {
    await reorderElements("case1", "find1", ["b", "a"]);
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/elements/reorder/");
    expect(JSON.parse(opts.body as string)).toEqual({ ordered_ids: ["b", "a"] });
  });

  it("addCitation POSTs to the element's citations collection", async () => {
    await addCitation("case1", "find1", "el1", { document_id: "d1", page_reference: "p3", context_note: "" });
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/api/cases/case1/findings/find1/elements/el1/citations/");
    expect(opts.method).toBe("POST");
  });

  it("updateElement PATCHes the element with the given body", async () => {
    await updateElement("case1", "find1", "el1", { handoff_ready: true });
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/api/cases/case1/findings/find1/elements/el1/");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ handoff_ready: true });
  });

  it("deleteElement DELETEs the element", async () => {
    await deleteElement("case1", "find1", "el1");
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/api/cases/case1/findings/find1/elements/el1/");
    expect(opts.method).toBe("DELETE");
  });

  it("removeCitation DELETEs the nested citation route", async () => {
    await removeCitation("case1", "find1", "el1", "c9");
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/api/cases/case1/findings/find1/elements/el1/citations/c9/");
    expect(opts.method).toBe("DELETE");
  });
});
