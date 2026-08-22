import { describe, expect, it } from "vitest";

import { relationshipContracts, relationshipTypes } from "./relationships";

describe("relationship semantic contract", () => {
  it("defines every registered relationship exactly once", () => {
    expect(Object.keys(relationshipContracts)).toEqual(relationshipTypes);
  });

  it("keeps conversation semantics separate from mutation provenance", () => {
    expect(relationshipContracts.discusses.automation).toBe("deterministic_conversation_context");
    expect(relationshipContracts.discusses.notFor).toContain("Memory revisions");
    expect(relationshipContracts.produced.automation).toBe("deterministic_creation_provenance");
    expect(relationshipContracts.produced.notFor).toContain("Updates");
  });

  it("distinguishes semantic support from assertion provenance", () => {
    expect(relationshipContracts.supports.notFor).toContain("Assertion provenance");
  });
});
