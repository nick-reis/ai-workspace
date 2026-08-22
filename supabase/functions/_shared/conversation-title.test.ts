import { describe, expect, it } from "vitest";

import { normalizeConversationTitle } from "./conversation-title.ts";

describe("conversation title normalization", () => {
  it("removes chatty formatting from a generated title", () => {
    expect(normalizeConversationTitle('"BGP Study Planning"', "Plan my BGP study"))
      .toBe("BGP Study Planning");
  });

  it("falls back to the opening message for empty or generic output", () => {
    expect(normalizeConversationTitle("New conversation", "  How does BGP path selection work?  "))
      .toBe("How does BGP path selection work?");
  });

  it("bounds titles to the node title limit used by chat", () => {
    expect(normalizeConversationTitle("x".repeat(100), "fallback")).toHaveLength(80);
  });
});
