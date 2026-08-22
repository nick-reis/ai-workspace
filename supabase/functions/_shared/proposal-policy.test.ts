import { describe, expect, it } from "vitest";

import {
  containsExplicitMention,
  isMemoryStatementGrounded,
  isMeaningfulRelationshipReason,
  mergeExplicitMentionConnections,
  normalizeRelationshipSuggestions,
  selectEligibleMemorySourceIds,
  shouldExtractMemoryForTurn,
} from "./proposal-policy.ts";

describe("relationship proposal policy", () => {
  it("rejects negative explanations instead of surfacing them as suggestions", () => {
    expect(isMeaningfulRelationshipReason("No meaningful connection is established.")).toBe(false);
    expect(normalizeRelationshipSuggestions([{
      existing_node_id: "node-1",
      direction: "memory_to_node",
      relationship_type: "related_to",
      reason: "The note is unrelated, so no meaningful connection is established.",
      confidence: 0.98,
      selected: true,
    }], new Set(["node-1"]))).toEqual([]);
  });

  it("normalizes evidence-backed suggestions for either proposal flow", () => {
    expect(normalizeRelationshipSuggestions([{
      existing_node_id: "node-1",
      direction: "memory_to_node",
      relationship_type: "supports",
      reason: "The preference directly changes how explanations for this node should be presented.",
      confidence: 0.82,
      selected: true,
    }], new Set(["node-1"]))).toEqual([{
      existing_node_id: "node-1",
      direction: "memory_to_node",
      relationship_type: "supports",
      reason: "The preference directly changes how explanations for this node should be presented.",
      confidence: 0.82,
      selected: true,
    }]);
  });

  it("rejects invalid relationship semantics and duplicate suggestions", () => {
    const valid = {
      existing_node_id: "node-1",
      direction: "memory_to_node",
      relationship_type: "about",
      reason: "The Memory is explicitly scoped to this node.",
      confidence: 0.9,
      selected: true,
    };
    expect(normalizeRelationshipSuggestions([
      valid,
      valid,
      { ...valid, relationship_type: "produced" },
      { ...valid, direction: "sideways" },
    ], new Set(["node-1"]))).toEqual([valid]);
  });

  it("adds an about connection when a Memory explicitly names an allowed node", () => {
    expect(containsExplicitMention("When talking about my Homelab, keep it concise.", "Homelab")).toBe(true);
    expect(mergeExplicitMentionConnections([], new Set(["homelab-id"]), [{
      id: "homelab-id",
      title: "Homelab",
      matched_label: "Homelab",
    }], "Homelab response preference: keep answers concise.")).toEqual([{
      existing_node_id: "homelab-id",
      direction: "memory_to_node",
      relationship_type: "about",
      reason: "The user explicitly scoped this Memory to Homelab.",
      confidence: 0.95,
      selected: true,
    }]);
  });

  it("does not invent a connection from context or similarity alone", () => {
    expect(mergeExplicitMentionConnections([], new Set(["diagram-memory-id"]), [{
      id: "diagram-memory-id",
      title: "Prefers explanations with diagrams",
      matched_label: "Prefers explanations with diagrams",
    }], "When talking about my Homelab, I prefer concise answers.")).toEqual([]);
  });

  it("corrects a reversed about suggestion for an explicitly scoped Memory", () => {
    expect(mergeExplicitMentionConnections([{
      existing_node_id: "bgp-id",
      direction: "node_to_memory",
      relationship_type: "about",
      reason: "The BGP note is about this preference.",
      confidence: 0.91,
      selected: true,
    }], new Set(["bgp-id"]), [{
      id: "bgp-id",
      title: "BGP",
      matched_label: "BGP",
    }], "Prefers short BGP answers")).toEqual([{
      existing_node_id: "bgp-id",
      direction: "memory_to_node",
      relationship_type: "about",
      reason: "The user explicitly scoped this Memory to BGP.",
      confidence: 0.95,
      selected: true,
    }]);
  });

  it("does not duplicate note-authoring content as a Memory", () => {
    const mutations = new Set(["notes_create"]);
    expect(shouldExtractMemoryForTurn("Create a Homelab note containing my networking setup.", mutations)).toBe(false);
    expect(shouldExtractMemoryForTurn("Create that note, and remember that I prefer diagrams.", mutations)).toBe(true);
    expect(shouldExtractMemoryForTurn("Remember that PB&J is my favorite midnight snack.", new Set())).toBe(true);
  });

  it("does not turn graph commands or recap requests into Memories", () => {
    expect(shouldExtractMemoryForTurn(
      "Propose that BGP supports Cloudflare Interview because it contributes to my preparation.",
      new Set(["graph_propose_relationship"]),
    )).toBe(false);
    expect(shouldExtractMemoryForTurn(
      "Summarize the decisions and open questions from this planning session.",
      new Set(),
    )).toBe(false);
  });

  it("uses the current user message as Memory evidence except for a short confirmation", () => {
    const messages = [
      { id: "older", role: "user", content: "I prefer diagrams." },
      { id: "assistant", role: "assistant", content: "Should I remember that?" },
      { id: "latest", role: "user", content: "Yes." },
    ];
    expect([...selectEligibleMemorySourceIds(messages)]).toEqual(["latest", "older"]);
    expect([...selectEligibleMemorySourceIds([
      ...messages,
      { id: "recap", role: "user", content: "Summarize this conversation." },
    ])]).toEqual(["recap"]);
  });

  it("rejects Memory statements that are not grounded in their cited user messages", () => {
    expect(isMemoryStatementGrounded(
      "The user wants to practice route advertisements in their Homelab before reviewing theory.",
      ["I have decided to practice route advertisements in my Homelab before reviewing theory."],
    )).toBe(true);
    expect(isMemoryStatementGrounded(
      "The user wants to understand local preference in practical BGP troubleshooting.",
      ["I have decided to practice route advertisements in my Homelab before reviewing theory."],
    )).toBe(false);
  });
});
