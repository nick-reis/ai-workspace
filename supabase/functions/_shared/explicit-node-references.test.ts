import { describe, expect, it } from "vitest";

import {
  buildExplicitNodeReferences,
  toolChoiceForExplicitReferences,
} from "./explicit-node-references.ts";

const exact = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "note",
  title: "Cloudflare Interview",
  matched_label: "Cloudflare Interview",
  match_reason: "explicit_title",
  match_score: 1,
};

describe("explicit node references", () => {
  it("keeps exact and fuzzy title or alias identities with their match evidence", () => {
    const alias = { ...exact, id: "22222222-2222-4222-8222-222222222222", match_reason: "explicit_alias" };
    const typo = { ...exact, id: "33333333-3333-4333-8333-333333333333", match_reason: "typo_title", match_score: 0.82 };

    expect(buildExplicitNodeReferences([exact, alias, typo])).toEqual([exact, alias, typo]);
  });

  it("deduplicates references and enforces the shared cap", () => {
    const second = { ...exact, id: "22222222-2222-4222-8222-222222222222" };
    expect(buildExplicitNodeReferences([exact, exact, second], 1)).toEqual([exact]);
  });

  it("contains identity metadata only", () => {
    expect(buildExplicitNodeReferences([{ ...exact, summary: "do not expose", markdown: "secret" }])[0])
      .toEqual(exact);
  });

  it("requires one model-chosen tool only on the first anchored round", () => {
    expect(toolChoiceForExplicitReferences(0, 1)).toBe("required");
    expect(toolChoiceForExplicitReferences(0, 0)).toBe("auto");
    expect(toolChoiceForExplicitReferences(1, 1)).toBe("auto");
  });
});
