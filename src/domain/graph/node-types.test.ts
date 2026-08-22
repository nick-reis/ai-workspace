import { describe, expect, it } from "vitest";

import {
  getNodeTypeDefinition,
  nodeTypeDefinitions,
  nodeTypeSchema,
  nodeTypes,
} from "./node-types";

describe("node type registry", () => {
  it("is exhaustive for the supported graph node types", () => {
    expect(nodeTypes).toEqual(["conversation", "memory", "note"]);
    expect(Object.keys(nodeTypeDefinitions).sort()).toEqual([...nodeTypes].sort());
    expect(nodeTypeSchema.options).toEqual(nodeTypes);
    expect(() => nodeTypeSchema.parse("project")).toThrow();
  });

  it("owns display and graph metadata for each type", () => {
    expect(getNodeTypeDefinition("conversation")).toMatchObject({
      label: "Conversation",
      pluralLabel: "Conversations",
      tone: "amber",
      graphColor: "#f472b6",
      labelPriority: 10,
    });
    expect(getNodeTypeDefinition("memory")).toMatchObject({
      label: "Memory",
      pluralLabel: "Memories",
      tone: "rose",
      graphColor: "#c084fc",
      labelPriority: 90,
    });
    expect(getNodeTypeDefinition("note")).toMatchObject({
      label: "Note",
      pluralLabel: "Notes",
      tone: "blue",
      graphColor: "#60a5fa",
      labelPriority: 100,
    });
    for (const type of nodeTypes) expect(nodeTypeDefinitions[type].icon).toBeDefined();
  });
});
