import { beforeEach, describe, expect, it, vi } from "vitest";

import { searchWorkspaceNodes } from "./workspace-search-api";

const searchNodes = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: searchNodes },
}));

const node = (title: string, updatedAt: string, summary: string | null = null) => ({
  id: crypto.randomUUID(),
  owner_id: "00000000-0000-4000-8000-000000000099",
  type: "note" as const,
  title,
  summary,
  version: 1,
  created_at: updatedAt,
  updated_at: updatedAt,
  archived_at: null,
});

describe("searchWorkspaceNodes", () => {
  beforeEach(() => searchNodes.mockReset());

  it("keeps title matches only and ranks exact, prefix, then contains", async () => {
    searchNodes.mockResolvedValue({
      data: [
        node("Project Alpha", "2026-08-22T13:00:00Z"),
        node("Hidden result", "2026-08-22T14:00:00Z", "Alpha only appears here"),
        node("Alpha planning", "2026-08-22T11:00:00Z"),
        node("Alpha", "2026-08-22T10:00:00Z"),
        node("Alpha retrospective", "2026-08-22T12:00:00Z"),
      ],
      error: null,
    });

    const results = await searchWorkspaceNodes(" alpha ", null);

    expect(results.map((result) => result.title)).toEqual([
      "Alpha",
      "Alpha retrospective",
      "Alpha planning",
      "Project Alpha",
    ]);
    expect(searchNodes).toHaveBeenCalledWith("search_nodes", {
      p_query: "alpha",
      p_types: null,
      p_limit: 50,
    });
  });
});
