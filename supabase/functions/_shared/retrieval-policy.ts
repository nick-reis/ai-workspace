type RetrievalCandidate = Record<string, unknown>;

export const MIN_SOURCE_PANEL_SEMANTIC_SIMILARITY = 0.62;

function retrievalEvidence(candidate: RetrievalCandidate) {
  return Array.isArray(candidate.retrieval_evidence)
    ? candidate.retrieval_evidence.filter((value): value is string => typeof value === "string")
    : [];
}

function hasLexicalEvidence(candidate: RetrievalCandidate) {
  return retrievalEvidence(candidate).some((value) =>
    value !== "semantic_similarity"
    && !value.startsWith("modified_at:")
    && !value.startsWith("created_at:"),
  );
}

/**
 * Reasoning receives every ranked candidate within the caller's hard bound.
 * This policy is only for the user-facing Sources panel, where weak semantic
 * neighbors would otherwise look more authoritative than they are.
 */
export function isSourcePanelSearchCandidate(candidate: RetrievalCandidate) {
  if (hasLexicalEvidence(candidate)) return true;
  return Number(candidate.similarity) >= MIN_SOURCE_PANEL_SEMANTIC_SIMILARITY;
}
