import { describe, expect, it } from "vitest";

import { nodeTypeDefinitions } from "@/domain/graph/node-types";
import type { Neighborhood, NodeSummary } from "@/types/graph";

import { toGraphData } from "./graph-adapter";

const ownerId = "00000000-0000-4000-8000-000000000099";
const makeNode = (id: string, type: NodeSummary["type"]): NodeSummary => ({
  id,
  owner_id: ownerId,
  type,
  title: type,
  summary: null,
  version: 1,
  created_at: "2026-08-22T10:00:00Z",
  updated_at: "2026-08-22T10:00:00Z",
  archived_at: null,
});

describe("toGraphData", () => {
  it("uses the canonical metadata for every node type", () => {
    const neighborhood: Neighborhood = {
      nodes: [
        makeNode("00000000-0000-4000-8000-000000000001", "conversation"),
        makeNode("00000000-0000-4000-8000-000000000002", "memory"),
        makeNode("00000000-0000-4000-8000-000000000003", "note"),
      ],
      edges: [],
      assertions: [],
    };

    const graph = toGraphData(neighborhood);
    for (const node of neighborhood.nodes) {
      expect(graph.nodes.find((candidate) => candidate.id === node.id)).toMatchObject({
        color: nodeTypeDefinitions[node.type].graphColor,
        labelPriority: nodeTypeDefinitions[node.type].labelPriority,
      });
    }
  });
});
