export const MIN_AI_RELATIONSHIP_CONFIDENCE = 0.7;

const meaninglessConnectionPattern = /\b(no (?:meaningful|direct|clear|relevant) connection|not (?:meaningfully|directly|clearly) related|unrelated|no relationship (?:exists|is established)|should not be connected)\b/i;
const explicitMemoryRequestPattern = /\b(?:remember(?: this| that)?|keep (?:this|that) in mind|save (?:this|that) as (?:a )?memory)\b/i;
const memoryExtractionMetaRequestPattern = /\b(?:summari[sz]e|recap|review)\b[\s\S]{0,80}\b(?:conversation|chat|session|decisions?|open (?:questions?|loops?)|what (?:i|we) (?:decided|discussed))\b|\bwhat did (?:i|we) decide\b/i;
const shortConfirmationPattern = /^(?:yes|yeah|yep|correct|right|exactly|that(?:'s| is) right|confirmed|please do|do that|sounds good|agreed)[.!\s]*$/i;

const groundingStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "but", "by", "for", "from",
  "has", "have", "i", "in", "is", "it", "my", "of", "on", "or", "that", "the", "their",
  "they", "this", "to", "user", "was", "when", "with", "would",
]);

export function isMeaningfulRelationshipReason(reason: unknown) {
  const normalized = String(reason ?? "").trim();
  return normalized.length > 0 && !meaninglessConnectionPattern.test(normalized);
}

export function shouldExtractMemoryForTurn(
  userMessage: unknown,
  completedMutationTools: ReadonlySet<string>,
) {
  const message = String(userMessage ?? "");
  if (explicitMemoryRequestPattern.test(message)) return true;

  // Commands that mutate the workspace describe what the AI should do, not a
  // durable fact about the user. The explicit-memory escape hatch above keeps
  // mixed requests such as "create this note and remember..." possible.
  if (completedMutationTools.size > 0) return false;

  // A recap request must not re-extract old statements from the context window
  // as if the user had asserted them again in the current turn.
  return !memoryExtractionMetaRequestPattern.test(message);
}

export type MemorySourceMessage = {
  id: unknown;
  role: unknown;
  content: unknown;
};

export function selectEligibleMemorySourceIds(messages: readonly MemorySourceMessage[]) {
  const userMessages = messages.filter((message) => message.role === "user" && typeof message.id === "string");
  const latest = userMessages.at(-1);
  if (!latest) return new Set<string>();

  const ids = new Set<string>([String(latest.id)]);
  if (shortConfirmationPattern.test(String(latest.content ?? "").trim())) {
    const preceding = userMessages.at(-2);
    if (preceding) ids.add(String(preceding.id));
  }
  return ids;
}

function groundingTokens(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length >= 3 && !groundingStopWords.has(token)) ?? [];
}

export function isMemoryStatementGrounded(statement: unknown, sourceTexts: readonly unknown[]) {
  const candidateTokens = [...new Set(groundingTokens(statement))];
  if (!candidateTokens.length) return false;
  const sourceTokens = new Set(sourceTexts.flatMap(groundingTokens));
  const supported = candidateTokens.filter((token) => sourceTokens.has(token)).length;

  // Preserve the user's wording in the extraction prompt. This check is a
  // final guard against unrelated claims while still allowing light framing
  // such as "The user prefers...".
  return supported >= Math.min(2, candidateTokens.length)
    && supported / candidateTokens.length >= 0.4;
}

export type NormalizedRelationshipSuggestion = {
  existing_node_id: string;
  direction: "memory_to_node" | "node_to_memory";
  relationship_type: "related_to" | "references" | "about" | "part_of" | "supports" | "derived_from";
  reason: string;
  confidence: number;
  selected: true;
};

const memoryConnectionDirections = new Set(["memory_to_node", "node_to_memory"]);
const memoryConnectionRelationshipTypes = new Set([
  "related_to",
  "references",
  "about",
  "part_of",
  "supports",
  "derived_from",
]);

export type ExplicitMentionTarget = {
  id: unknown;
  title?: unknown;
  matched_label?: unknown;
};

function normalizeMentionText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function containsExplicitMention(value: unknown, label: unknown) {
  const normalizedValue = normalizeMentionText(value);
  const normalizedLabel = normalizeMentionText(label);
  return normalizedLabel.length >= 3 && ` ${normalizedValue} `.includes(` ${normalizedLabel} `);
}

export function normalizeRelationshipSuggestions(
  values: unknown,
  allowedNodeIds: ReadonlySet<string>,
  limit = 8,
): NormalizedRelationshipSuggestion[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  return values.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const candidate = value as Record<string, unknown>;
    const nodeId = candidate.existing_node_id;
    const confidence = candidate.confidence;
    const direction = candidate.direction;
    const relationshipType = candidate.relationship_type;
    const reason = String(candidate.reason ?? "").trim().slice(0, 1_000);
    if (typeof nodeId !== "string"
      || !allowedNodeIds.has(nodeId)
      || typeof direction !== "string"
      || !memoryConnectionDirections.has(direction)
      || typeof relationshipType !== "string"
      || !memoryConnectionRelationshipTypes.has(relationshipType)
      || candidate.selected !== true
      || typeof confidence !== "number"
      || confidence < MIN_AI_RELATIONSHIP_CONFIDENCE
      || !isMeaningfulRelationshipReason(reason)) return [];

    const semanticKey = `${nodeId}:${direction}:${relationshipType}`;
    if (seen.has(semanticKey)) return [];
    seen.add(semanticKey);

    return [{
      existing_node_id: nodeId,
      direction: direction as NormalizedRelationshipSuggestion["direction"],
      relationship_type: relationshipType as NormalizedRelationshipSuggestion["relationship_type"],
      reason,
      confidence,
      selected: true as const,
    }];
  }).slice(0, Math.max(0, limit));
}

export function mergeExplicitMentionConnections(
  values: unknown,
  allowedNodeIds: ReadonlySet<string>,
  explicitTargets: readonly ExplicitMentionTarget[],
  candidateText: unknown,
  limit = 8,
): NormalizedRelationshipSuggestion[] {
  const normalized = normalizeRelationshipSuggestions(values, allowedNodeIds, limit);

  for (const target of explicitTargets) {
    if (typeof target.id !== "string" || !allowedNodeIds.has(target.id)) continue;
    const matchedLabel = String(target.matched_label ?? target.title ?? "").trim();
    if (!containsExplicitMention(candidateText, matchedLabel)) continue;
    const displayTitle = String(target.title ?? matchedLabel).trim().slice(0, 240) || "the named node";
    const canonicalConnection: NormalizedRelationshipSuggestion = {
      existing_node_id: target.id,
      direction: "memory_to_node",
      relationship_type: "about",
      reason: `The user explicitly scoped this Memory to ${displayTitle}.`,
      confidence: 0.95,
      selected: true,
    };
    const existingIndex = normalized.findIndex((connection) => connection.existing_node_id === target.id);
    if (existingIndex >= 0) {
      normalized[existingIndex] = canonicalConnection;
    } else if (normalized.length < Math.max(0, limit)) {
      normalized.push(canonicalConnection);
    }
  }

  return normalized;
}
