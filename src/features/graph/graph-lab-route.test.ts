import { describe, expect, it } from "vitest";

import type { Neighborhood } from "@/types/graph";

import { toGraphData } from "./graph-adapter";

describe("Graph Supabase adapter", () => {
  it("maps workspace nodes and relationships to the backend-free renderer contract", () => {
    const rowDefaults = {
      owner_id: "owner-1",
      summary: null,
      version: 1,
      created_at: "2026-08-17T00:00:00Z",
      updated_at: "2026-08-17T00:00:00Z",
      archived_at: null,
    };
    const neighborhood: Neighborhood = {
      nodes: [
        { ...rowDefaults, id: "note-1", type: "note", title: "Architecture" },
        { ...rowDefaults, id: "memory-1", type: "memory", title: "Prefer WebGL" },
      ],
      edges: [
        {
          id: "edge-1",
          owner_id: "owner-1",
          source_node_id: "note-1",
          target_node_id: "memory-1",
          relationship_type: "related_to",
          created_at: "2026-08-17T00:00:00Z",
          updated_at: "2026-08-17T00:00:00Z",
          archived_at: null,
        },
      ],
      assertions: [],
    };

    expect(toGraphData(neighborhood)).toEqual({
      nodes: [
        { id: "note-1", label: "Architecture", labelPriority: 108, color: "#60a5fa", radius: 7.2 },
        { id: "memory-1", label: "Prefer WebGL", labelPriority: 98, color: "#c084fc", radius: 7.2 },
      ],
      edges: [
        { id: "edge-1", source: "note-1", target: "memory-1", relationshipType: "related_to", color: "#94a3b8" },
      ],
    });
  });
});
