type JsonRecord = Record<string, unknown>;

export const MAX_EXPLICIT_NODE_REFERENCES = 4;

export type ExplicitNodeReference = {
  id: string;
  type: string;
  title: string;
  matched_label: string;
  match_reason: "explicit_title" | "explicit_alias" | "typo_title" | "typo_alias";
  match_score: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mentionReason(value: unknown): ExplicitNodeReference["match_reason"] | null {
  return value === "explicit_title" || value === "explicit_alias" ||
      value === "typo_title" || value === "typo_alias"
    ? value
    : null;
}

/**
 * Produces bounded, identity-only graph anchors. These references help the
 * model address tools by stable ID; they are not content and not used evidence.
 */
export function buildExplicitNodeReferences(
  resolvedMentions: unknown,
  maxReferences = MAX_EXPLICIT_NODE_REFERENCES,
): ExplicitNodeReference[] {
  if (!Array.isArray(resolvedMentions)) return [];
  const seen = new Set<string>();
  const references: ExplicitNodeReference[] = [];

  for (const value of resolvedMentions) {
    if (references.length >= Math.max(0, Math.floor(maxReferences))) break;
    if (!isRecord(value)) continue;
    const id = typeof value.id === "string" ? value.id : null;
    const type = typeof value.type === "string" ? value.type : null;
    const title = typeof value.title === "string" ? value.title : null;
    const reason = mentionReason(value.match_reason);
    const score = Number(value.match_score);
    if (!id || !type || !title || !reason || !Number.isFinite(score) || seen.has(id)) continue;

    seen.add(id);
    references.push({
      id,
      type,
      title,
      matched_label: typeof value.matched_label === "string" ? value.matched_label : title,
      match_reason: reason,
      match_score: score,
    });
  }

  return references;
}

/**
 * An explicitly anchored first round must inspect the graph before answering.
 * The full tool registry remains available and the model still chooses the
 * appropriate tool; later rounds return to automatic tool choice.
 */
export function toolChoiceForExplicitReferences(
  modelRound: number,
  explicitReferenceCount: number,
): "required" | "auto" {
  return modelRound === 0 && explicitReferenceCount > 0 ? "required" : "auto";
}
