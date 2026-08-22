export const relationshipTypes = [
  "related_to",
  "references",
  "about",
  "part_of",
  "supports",
  "derived_from",
  "discusses",
  "produced",
] as const;

export type RelationshipType = typeof relationshipTypes[number];

export type RelationshipAutomation =
  | "review_required"
  | "deterministic_wiki_link"
  | "deterministic_conversation_context"
  | "deterministic_creation_provenance"
  | "never_automatic";

export type RelationshipContract = {
  label: string;
  inverseLabel: string;
  purpose: string;
  sourceToTarget: string;
  notFor: string;
  symmetric: boolean;
  automation: RelationshipAutomation;
  color: string;
};

/**
 * UI/domain projection of the authoritative SQL relationship registry.
 * Keep this deliberately descriptive: each type answers a different semantic
 * question, while assertions separately answer why the claim is believed.
 */
export const relationshipContracts = {
  related_to: {
    label: "Related to",
    inverseLabel: "Related to",
    purpose: "A deliberately broad association when no precise registered relationship applies.",
    sourceToTarget: "A is meaningfully associated with B.",
    notFor: "Text similarity, co-retrieval, or a fallback chosen before checking precise types.",
    symmetric: true,
    automation: "review_required",
    color: "#94a3b8",
  },
  references: {
    label: "References",
    inverseLabel: "Referenced by",
    purpose: "An explicit citation, link, or pointer from source content to a target.",
    sourceToTarget: "A explicitly points to B.",
    notFor: "General subject matter, evidence, derivation, or mere textual similarity.",
    symmetric: false,
    automation: "deterministic_wiki_link",
    color: "#38bdf8",
  },
  about: {
    label: "About",
    inverseLabel: "Subject of",
    purpose: "The target is a substantial subject of the source.",
    sourceToTarget: "A is substantially about B.",
    notFor: "A citation, creation provenance, modification history, or a passing mention.",
    symmetric: false,
    automation: "review_required",
    color: "#f472b6",
  },
  part_of: {
    label: "Part of",
    inverseLabel: "Contains",
    purpose: "A compositional hierarchy in which the source belongs inside the target.",
    sourceToTarget: "A is a constituent of B.",
    notFor: "Loose grouping, topical similarity, sequencing, or dependency.",
    symmetric: false,
    automation: "review_required",
    color: "#fbbf24",
  },
  supports: {
    label: "Supports",
    inverseLabel: "Supported by",
    purpose: "The source contributes evidence, material, or progress toward the target.",
    sourceToTarget: "A substantively helps establish or advance B.",
    notFor: "Assertion provenance, agreement alone, containment, or derivation.",
    symmetric: false,
    automation: "review_required",
    color: "#4ade80",
  },
  derived_from: {
    label: "Derived from",
    inverseLabel: "Source of",
    purpose: "The source was transformed, computed, summarized, or otherwise produced from the target.",
    sourceToTarget: "A originates from B through a derivation process.",
    notFor: "Simple citation, creation by a conversation, or revision/audit history.",
    symmetric: false,
    automation: "review_required",
    color: "#c084fc",
  },
  discusses: {
    label: "Discusses",
    inverseLabel: "Discussed in",
    purpose: "A conversation substantially discusses an existing Note as subject matter.",
    sourceToTarget: "Conversation A substantially discusses existing Note B.",
    notFor: "Retrieval candidates, selected UI context, Memory revisions, unapproved relationship proposals, or incidental entity loads.",
    symmetric: false,
    automation: "deterministic_conversation_context",
    color: "#fb923c",
  },
  produced: {
    label: "Produced",
    inverseLabel: "Produced in",
    purpose: "A conversation directly caused a new durable entity to be created.",
    sourceToTarget: "Conversation A created entity B.",
    notFor: "Updates, discussions, retrieval, citations, or entities that existed before the conversation.",
    symmetric: false,
    automation: "deterministic_creation_provenance",
    color: "#2dd4bf",
  },
} as const satisfies Record<RelationshipType, RelationshipContract>;
