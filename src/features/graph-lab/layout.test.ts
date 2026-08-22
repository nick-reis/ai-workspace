import { describe, expect, it } from "vitest";

import { makeInitialPositions } from "./layout";

describe("D3-style graph initialization", () => {
  it("uses deterministic phyllotaxis positions", () => {
    const count = 180;
    const positions = makeInitialPositions(count);
    let furthest = 0;
    for (let index = 0; index < count; index += 1) {
      furthest = Math.max(furthest, Math.hypot(positions[index * 2], positions[index * 2 + 1]));
    }
    expect(furthest).toBeCloseTo(10 * Math.sqrt(count - 0.5), 3);
    expect(makeInitialPositions(count)).toEqual(positions);
  });

  it("naturally expands as nodes are added", () => {
    const small = makeInitialPositions(100);
    const large = makeInitialPositions(400);
    expect(Math.hypot(large[798], large[799])).toBeGreaterThan(Math.hypot(small[198], small[199]));
  });
});
