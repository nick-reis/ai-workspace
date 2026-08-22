import { z } from "zod";

import { nodeTypeSchema } from "@/domain/graph/node-types";
import { relationshipTypes, type RelationshipType } from "@/domain/graph/relationships";

export { nodeTypeSchema } from "@/domain/graph/node-types";
export type { NodeType } from "@/domain/graph/node-types";
export type { RelationshipType } from "@/domain/graph/relationships";

export const relationshipTypeSchema: z.ZodType<RelationshipType> = z.enum(relationshipTypes);

export const relationshipDefinitionSchema = z.object({
  name: relationshipTypeSchema,
  label: z.string(),
  inverse_label: z.string().nullable(),
  description: z.string().nullable(),
  is_symmetric: z.boolean(),
  is_hierarchical: z.boolean(),
  must_be_acyclic: z.boolean(),
  allows_self_reference: z.boolean(),
});
export type RelationshipDefinition = z.infer<typeof relationshipDefinitionSchema>;

export const nodeSummarySchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  type: nodeTypeSchema,
  title: z.string(),
  summary: z.string().nullable(),
  version: z.coerce.number(),
  created_at: z.string(),
  updated_at: z.string(),
  archived_at: z.string().nullable(),
});
export type NodeSummary = z.infer<typeof nodeSummarySchema>;

export const noteSchema = z.object({
  node_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  markdown: z.string(),
  format_version: z.coerce.number(),
  content_version: z.coerce.number(),
  parsed_at: z.string().nullable(),
  updated_at: z.string(),
});

export const memorySourceSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  revision_id: z.string().uuid(),
  source_message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  ai_run_id: z.string().uuid().nullable(),
  message_content: z.string(),
  created_at: z.string(),
});
export type MemorySource = z.infer<typeof memorySourceSchema>;

export const memoryRevisionSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  memory_node_id: z.string().uuid(),
  revision: z.coerce.number(),
  title: z.string(),
  kind: z.enum(["fact", "preference", "goal", "constraint", "skill"]),
  statement: z.string(),
  confidence: z.coerce.number(),
  expires_at: z.string().nullable(),
  source_ai_run_id: z.string().uuid().nullable(),
  restored_from_revision: z.coerce.number().nullable(),
  created_at: z.string(),
  sources: z.array(memorySourceSchema),
});
export type MemoryRevision = z.infer<typeof memoryRevisionSchema>;

export const memorySchema = z.object({
  node_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  semantic_key: z.string(),
  kind: z.enum(["fact", "preference", "goal", "constraint", "skill"]),
  statement: z.string(),
  confidence: z.coerce.number(),
  expires_at: z.string().nullable(),
  current_revision: z.coerce.number(),
  confirmed_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  revisions: z.array(memoryRevisionSchema),
});
export type Memory = z.infer<typeof memorySchema>;

export const edgeSummarySchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  source_node_id: z.string().uuid(),
  target_node_id: z.string().uuid(),
  relationship_type: relationshipTypeSchema,
  created_at: z.string(),
  updated_at: z.string(),
  archived_at: z.string().nullable(),
});
export type EdgeSummary = z.infer<typeof edgeSummarySchema>;

export const edgeAssertionSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  edge_id: z.string().uuid(),
  provenance: z.enum(["user", "markdown", "ai", "system", "ingestion"]),
  actor_id: z.string().uuid().nullable(),
  source_node_id: z.string().uuid().nullable(),
  source_message_id: z.string().uuid().nullable(),
  source_ai_run_id: z.string().uuid().nullable(),
  origin_key: z.string().nullable(),
  reason: z.string().nullable(),
  confidence: z.number().nullable(),
  source_locator: z.record(z.string(), z.unknown()),
  status: z.enum(["active", "proposed", "rejected", "retracted"]),
  created_at: z.string(),
  updated_at: z.string(),
  retracted_at: z.string().nullable(),
});
export type EdgeAssertion = z.infer<typeof edgeAssertionSchema>;

export const neighborhoodSchema = z.object({
  nodes: z.array(nodeSummarySchema),
  edges: z.array(edgeSummarySchema),
  assertions: z.array(edgeAssertionSchema),
});
export type Neighborhood = z.infer<typeof neighborhoodSchema>;

export const nodeBundleSchema = z.object({
  node: nodeSummarySchema,
  note: noteSchema.nullable(),
  conversation: z.unknown().nullable(),
  conversation_summary: z.object({
    conversation_id: z.string().uuid(),
    owner_id: z.string().uuid(),
    summary: z.string(),
    topics: z.array(z.string()),
    decisions: z.array(z.object({ statement: z.string(), message_ids: z.array(z.string().uuid()) })),
    open_loops: z.array(z.object({ statement: z.string(), message_ids: z.array(z.string().uuid()) })),
    salient_facts: z.array(z.object({ statement: z.string(), message_ids: z.array(z.string().uuid()) })),
    message_count: z.coerce.number(),
    through_message_id: z.string().uuid().nullable(),
    through_message_sequence: z.coerce.number().nullable(),
    summary_version: z.coerce.number(),
    model: z.string().nullable(),
    status: z.enum(["stale", "current", "error"]),
    generated_at: z.string().nullable(),
    updated_at: z.string(),
  }).nullable().optional(),
  memory: memorySchema.nullable(),
  aliases: z.array(z.unknown()),
  unresolved_links: z.array(z.object({
    id: z.string().uuid(),
    target_label: z.string(),
    status: z.enum(["unresolved", "ambiguous"]),
    candidate_node_ids: z.array(z.string().uuid()),
    source_locations: z.unknown(),
  }).passthrough()),
});
export type NodeBundle = z.infer<typeof nodeBundleSchema>;

export const graphChangeSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  ai_run_id: z.string().uuid().nullable(),
  assertion_id: z.string().uuid().nullable(),
  node_id: z.string().uuid().nullable(),
  operation: z.enum(["create_node", "update_node", "archive_node", "restore_node", "update_note", "create_assertion", "retract_assertion", "request_relationship"]),
  actor: z.enum(["user", "ai", "system", "markdown"]),
  approval_state: z.enum(["proposed", "applied", "rejected", "superseded", "undone"]),
  reason: z.string().nullable(),
  before_snapshot: z.unknown().nullable(),
  after_snapshot: z.unknown().nullable(),
  idempotency_key: z.string().nullable(),
  memory_proposal_id: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  undone_at: z.string().nullable(),
});
export type GraphChange = z.infer<typeof graphChangeSchema>;

export const memoryProposalConnectionSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  proposal_id: z.string().uuid(),
  existing_node_id: z.string().uuid(),
  existing_node_title: z.string().optional(),
  direction: z.enum(["memory_to_node", "node_to_memory"]),
  relationship_type: relationshipTypeSchema,
  reason: z.string(),
  confidence: z.coerce.number().nullable(),
  selected: z.boolean(),
  applied_edge_id: z.string().uuid().nullable(),
  applied_assertion_id: z.string().uuid().nullable(),
  edge_was_created: z.boolean().nullable(),
  assertion_was_created: z.boolean().nullable(),
  created_at: z.string(),
});
export type MemoryProposalConnection = z.infer<typeof memoryProposalConnectionSchema>;

const memoryProposalSourceSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  proposal_id: z.string().uuid(),
  source_message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  message_content: z.string(),
  created_at: z.string(),
});

export const proposalStatusSchema = z.enum(["pending", "approved", "rejected", "superseded"]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const activityStateSchema = z.enum(["pending", "applied", "rejected", "superseded", "undone"]);
export type ActivityState = z.infer<typeof activityStateSchema>;
export const activityActionSchema = z.enum(["approve", "reject", "undo"]);
export type ActivityAction = z.infer<typeof activityActionSchema>;

const activityPresentationSchema = z.object({
  state: activityStateSchema.optional(),
  available_actions: z.array(activityActionSchema).default([]),
});

export const memoryProposalActivitySchema = z.object({
  kind: z.literal("memory_proposal"),
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  ai_run_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  semantic_key: z.string(),
  action: z.enum(["create", "update"]),
  status: proposalStatusSchema,
  title: z.string(),
  memory_kind: z.enum(["fact", "preference", "goal", "constraint", "skill"]),
  statement: z.string(),
  confidence: z.coerce.number(),
  expires_at: z.string().nullable(),
  existing_memory_node_id: z.string().uuid().nullable(),
  memory_node_id: z.string().uuid().nullable(),
  superseded_by_proposal_id: z.string().uuid().nullable(),
  superseded_by_memory_id: z.string().uuid().nullable(),
  memory_was_created: z.boolean().nullable(),
  before_snapshot: z.unknown().nullable(),
  after_snapshot: z.unknown().nullable(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  undone_at: z.string().nullable(),
  sources: z.array(memoryProposalSourceSchema),
  connections: z.array(memoryProposalConnectionSchema),
}).extend(activityPresentationSchema.shape);
export type MemoryProposal = z.infer<typeof memoryProposalActivitySchema>;

export const relationshipProposalActivitySchema = z.object({
  kind: z.literal("relationship_proposal"),
  id: z.string().uuid(),
  status: proposalStatusSchema,
  source_node_id: z.string().uuid(),
  source_title: z.string(),
  target_node_id: z.string().uuid(),
  target_title: z.string(),
  relationship_type: relationshipTypeSchema,
  reason: z.string().nullable(),
  confidence: z.number().nullable(),
  ai_run_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  edge_id: z.string().uuid().nullable(),
  assertion_id: z.string().uuid().nullable(),
  superseded_by_proposal_id: z.string().uuid().nullable(),
  edge_was_created: z.boolean().nullable(),
  assertion_was_created: z.boolean().nullable(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  undone_at: z.string().nullable(),
}).extend(activityPresentationSchema.shape);

export const graphChangeActivitySchema = graphChangeSchema.omit({ owner_id: true }).extend({
  kind: z.literal("graph_change"),
  state: activityStateSchema.optional(),
  available_actions: z.array(activityActionSchema).default([]),
});

export const activityItemSchema = z.discriminatedUnion("kind", [
  relationshipProposalActivitySchema,
  memoryProposalActivitySchema,
  graphChangeActivitySchema,
]);
export type ActivityItem = z.infer<typeof activityItemSchema>;

export const activityCursorSchema = z.object({ created_at: z.string(), id: z.string().uuid() });
export const activityPageSchema = z.object({
  items: z.array(activityItemSchema),
  next_cursor: activityCursorSchema.nullable(),
  total_count: z.coerce.number(),
});
export type ActivityCursor = z.infer<typeof activityCursorSchema>;
export type ActivityPage = z.infer<typeof activityPageSchema>;

const evidenceNodeSchema = nodeSummarySchema.extend({
  content_excerpt: z.string().nullable(),
  cited_version: z.coerce.number().nullable(),
  current_content_version: z.coerce.number().nullable(),
  changed_since_answer: z.boolean(),
});
const evidenceAssertionSchema = edgeAssertionSchema;
const evidenceEdgeSchema = edgeSummarySchema.extend({
  source: nodeSummarySchema.pick({ id: true, title: true, type: true }),
  target: nodeSummarySchema.pick({ id: true, title: true, type: true }),
  assertions: z.array(evidenceAssertionSchema),
});
const evidenceMessageSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  conversation_title: z.string(),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
  created_at: z.string(),
  sequence: z.coerce.number(),
});
const evidenceConversationSummarySchema = z.object({
  conversation_id: z.string().uuid(),
  title: z.string(),
  summary: z.string(),
  summary_version: z.coerce.number(),
  cited_version: z.coerce.number().nullable(),
  changed_since_answer: z.boolean(),
  updated_at: z.string(),
});
const searchedEvidenceNodeSchema = nodeSummarySchema.extend({
  retrieval_score: z.coerce.number().nullable(),
  retrieval_evidence: z.array(z.string()),
});
export const messageEvidenceBundleSchema = z.object({
  message_id: z.string().uuid(),
  nodes: z.array(evidenceNodeSchema),
  cited_nodes: z.array(z.string().uuid()).default([]),
  searched_nodes: z.array(searchedEvidenceNodeSchema).default([]),
  edges: z.array(evidenceEdgeSchema),
  assertions: z.array(evidenceAssertionSchema),
  messages: z.array(evidenceMessageSchema),
  searched_messages: z.array(evidenceMessageSchema).default([]),
  conversation_summaries: z.array(evidenceConversationSummarySchema),
  paths: z.array(z.object({ node_ids: z.array(z.string()), edge_ids: z.array(z.string()) })),
  missing: z.object({
    nodes: z.array(z.string().uuid()),
    edges: z.array(z.string().uuid()),
    assertions: z.array(z.string().uuid()),
    messages: z.array(z.string().uuid()),
    searched_nodes: z.array(z.string().uuid()).default([]),
    searched_messages: z.array(z.string().uuid()).default([]),
  }),
});
export type MessageEvidenceBundle = z.infer<typeof messageEvidenceBundleSchema>;

export const streamedChatMessageSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
  status: z.enum(["pending", "streaming", "complete", "error"]),
  evidence: z.unknown(),
  metadata: z.unknown(),
  created_at: z.string(),
  sequence: z.number(),
  ai_run_id: z.string().uuid().nullable(),
});
export type StreamedChatMessage = z.infer<typeof streamedChatMessageSchema>;

export const chatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message.delta"), delta: z.string() }),
  z.object({ type: z.literal("tool.started"), name: z.string(), call_id: z.string() }),
  z.object({ type: z.literal("tool.completed"), name: z.string(), call_id: z.string(), result: z.unknown(), cached: z.boolean().optional() }),
  z.object({
    type: z.literal("evidence"),
    nodes: z.array(z.string()),
    cited_nodes: z.array(z.string()).optional(),
    searched_nodes: z.array(z.object({
      node_id: z.string(),
      retrieval_score: z.number().optional(),
      retrieval_evidence: z.array(z.string()),
    })).optional(),
    edges: z.array(z.string()),
    assertions: z.array(z.string()).optional(),
    paths: z.array(z.object({ node_ids: z.array(z.string()), edge_ids: z.array(z.string()) })).optional(),
    content: z.array(z.object({ node_id: z.string(), content_version: z.number().optional() })).optional(),
    messages: z.array(z.string()).optional(),
    searched_messages: z.array(z.string()).optional(),
    conversation_summaries: z.array(z.object({ conversation_id: z.string(), summary_version: z.number().optional() })).optional(),
  }),
  z.object({ type: z.literal("summary.updated"), conversation_id: z.string().uuid(), summary_version: z.number() }),
  z.object({ type: z.literal("conversation.title.updated"), conversation_id: z.string().uuid(), title: z.string() }),
  z.object({ type: z.literal("memory.proposed"), proposal_id: z.string().uuid(), ai_run_id: z.string().uuid() }),
  z.object({ type: z.literal("memory.extraction.completed"), proposal_ids: z.array(z.string().uuid()), error: z.string().nullable() }),
  z.object({ type: z.enum(["change.applied", "change.proposed"]), change: z.unknown(), ai_run_id: z.string().uuid() }),
  z.object({
    type: z.literal("response.ready"),
    conversation_id: z.string().uuid(),
    message_id: z.string().uuid(),
    ai_run_id: z.string().uuid(),
    request_message: streamedChatMessageSchema,
    response_message: streamedChatMessageSchema,
  }),
  z.object({ type: z.literal("done"), conversation_id: z.string().uuid(), message_id: z.string().uuid().optional(), ai_run_id: z.string().uuid() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;
