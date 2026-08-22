import { describe, expect, it } from "vitest";

import { mergeStreamMessages, takeStreamRevealChunk } from "./stream-presentation";

describe("takeStreamRevealChunk", () => {
  it("reveals a large completed response in bounded chunks without changing it", () => {
    const original = "This answer arrived as one network event, but should still reveal progressively.";
    const chunks: string[] = [];
    let remainder = original;
    while (remainder) {
      const next = takeStreamRevealChunk(remainder, 12);
      chunks.push(next.chunk);
      remainder = next.remainder;
    }
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(original);
  });

  it("merges persisted stream rows without duplicates or reordering", () => {
    const existing = [{ id: "one", sequence: 1, content: "Existing" }];
    const incoming = [
      { id: "two", sequence: 2, content: "Question" },
      { id: "three", sequence: 3, content: "Answer" },
    ];
    expect(mergeStreamMessages(existing, incoming)).toEqual([...existing, ...incoming]);
    expect(mergeStreamMessages([...existing, ...incoming], incoming)).toHaveLength(3);
  });
});
