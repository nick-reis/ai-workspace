import { describe, expect, it } from "vitest";

import {
  GRAPH_TOOLS,
  READ_TOOL_NAMES,
  parseGraphToolArguments,
  toolsForModelRound,
} from "./graph-tools.ts";

const validId = "11111111-1111-4111-8111-111111111111";

describe("graph tool capability policy", () => {
  it("exposes the complete static capability set on every reasoning round", () => {
    expect(toolsForModelRound(false)).toBe(GRAPH_TOOLS);
    expect(toolsForModelRound(false).map((tool) => tool.name)).toEqual(
      GRAPH_TOOLS.map((tool) => tool.name),
    );
    expect(toolsForModelRound(true)).toEqual([]);
  });

  it("classifies every read tool without inventing unknown capabilities", () => {
    const names = new Set(GRAPH_TOOLS.map((tool) => tool.name));
    expect([...READ_TOOL_NAMES].every((name) => names.has(name))).toBe(true);
    expect(names.size).toBe(GRAPH_TOOLS.length);
  });

  it("validates model arguments against the same schema sent to the model", () => {
    expect(parseGraphToolArguments("graph_get_node", JSON.stringify({
      node_id: validId,
      include_content: false,
    }))).toEqual({
      ok: true,
      args: { node_id: validId, include_content: false },
    });
    expect(parseGraphToolArguments("graph_get_node", "not json")).toEqual({
      ok: false,
      error: "invalid_tool_arguments_json",
    });
    expect(parseGraphToolArguments("graph_get_node", JSON.stringify({
      node_id: "not-a-uuid",
      include_content: false,
    }))).toEqual({
      ok: false,
      error: "invalid_tool_arguments: arguments.node_id must be a UUID.",
    });
    expect(parseGraphToolArguments("graph_get_node", JSON.stringify({
      node_id: validId,
      include_content: false,
      surprise: true,
    }))).toEqual({
      ok: false,
      error: "invalid_tool_arguments: arguments.surprise is not allowed.",
    });
  });
});
