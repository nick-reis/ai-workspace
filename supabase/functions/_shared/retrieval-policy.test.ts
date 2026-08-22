import { describe, expect, it } from "vitest";

import {
  MIN_SOURCE_PANEL_SEMANTIC_SIMILARITY,
  isSourcePanelSearchCandidate,
} from "./retrieval-policy.ts";

describe("Sources-panel search candidate policy", () => {
  it("hides weak semantic-only neighbors from the user-facing list", () => {
    expect(isSourcePanelSearchCandidate({
      retrieval_evidence: ["semantic_similarity", "modified_at:2026-08-20T00:00:00Z"],
      similarity: 0.41,
    })).toBe(false);
    expect(isSourcePanelSearchCandidate({
      retrieval_evidence: ["semantic_similarity"],
      similarity: MIN_SOURCE_PANEL_SEMANTIC_SIMILARITY,
    })).toBe(true);
  });

  it("keeps exact and lexical candidates regardless of embedding availability", () => {
    expect(isSourcePanelSearchCandidate({
      retrieval_evidence: ["exact_title"],
      similarity: 0,
    })).toBe(true);
  });
});
