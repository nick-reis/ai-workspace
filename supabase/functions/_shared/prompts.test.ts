import { describe, expect, it } from "vitest";

import {
  FINAL_SYNTHESIS_INSTRUCTION,
  GRAPH_REASONING_INSTRUCTIONS,
  MEMORY_EXTRACTION_INSTRUCTIONS,
} from "./prompts.ts";

describe("AI instruction contracts", () => {
  it("keeps retrieval separate from durable graph semantics", () => {
    expect(GRAPH_REASONING_INSTRUCTIONS).toContain("Similarity is retrieval evidence and never creates a relationship");
    expect(GRAPH_REASONING_INSTRUCTIONS).toContain("AI-authored Note updates may deterministically create conversation discussion context");
    expect(GRAPH_REASONING_INSTRUCTIONS).toContain("Retrieval, selected UI context, and Memory revisions never create a conversation relationship");
  });

  it("uses revision provenance instead of a relationship for Memory updates", () => {
    expect(MEMORY_EXTRACTION_INSTRUCTIONS).toContain("an update uses revision sources instead of a conversation edge");
  });

  it("keeps citations sparse while leaving other evidence inspectable", () => {
    expect(GRAPH_REASONING_INSTRUCTIONS).toContain("Cite each node at most once");
    expect(GRAPH_REASONING_INSTRUCTIONS).toContain("may remain only in the Sources panel");
  });

  it("grounds requests that depend on an explicitly referenced Note", () => {
    expect(GRAPH_REASONING_INSTRUCTIONS).toContain("identity-only anchors");
    expect(GRAPH_REASONING_INSTRUCTIONS).toContain("load its content by stable ID before answering");
    expect(GRAPH_REASONING_INSTRUCTIONS).toContain("They are not answer evidence");
    expect(GRAPH_REASONING_INSTRUCTIONS).toContain("judge fuzzy candidates cautiously");
  });

  it("reserves a reasoning-only final synthesis after the tool budget", () => {
    expect(FINAL_SYNTHESIS_INSTRUCTION).toContain("best grounded answer");
    expect(FINAL_SYNTHESIS_INSTRUCTION).toContain("State any uncertainty");
  });
});
