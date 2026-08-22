import { describe, expect, it, vi } from "vitest";

import { collectPaginatedRows, unwrapSupabaseResult } from "./supabase-result";

describe("Supabase result helpers", () => {
  it("loads through a full page instead of truncating the collection", async () => {
    const loadPage = vi.fn(async (from: number, to: number) => ({
      data: from === 0 ? ["a", "b"] : ["c"],
      error: null,
      requested: [from, to],
    }));

    await expect(collectPaginatedRows(loadPage, 2)).resolves.toEqual(["a", "b", "c"]);
    expect(loadPage).toHaveBeenNthCalledWith(1, 0, 1);
    expect(loadPage).toHaveBeenNthCalledWith(2, 2, 3);
  });

  it("preserves server errors and explicit empty-result failures", () => {
    expect(() => unwrapSupabaseResult({ data: null, error: { message: "forbidden" } })).toThrow("forbidden");
    expect(() => unwrapSupabaseResult({ data: null, error: null }, "missing")).toThrow("missing");
  });
});
