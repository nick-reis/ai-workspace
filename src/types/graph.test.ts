import { describe, expect, it } from "vitest";

import { activityItemSchema, activityPageSchema, chatEventSchema, messageEvidenceBundleSchema, nodeTypeSchema } from "./graph";

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;

describe("graph protocol models", () => {
  it("accepts Memory as an active graph node type", () => {
    expect(nodeTypeSchema.parse("memory")).toBe("memory");
  });

  it("parses editable Memory proposal bundles", () => {
    const proposal = activityItemSchema.parse({
      kind: "memory_proposal", id: id(20), owner_id: id(99), ai_run_id: id(21),
      conversation_id: id(22), semantic_key: "preference.explanation_style",
      action: "create", status: "pending", title: "Preferred explanation style",
      memory_kind: "preference", statement: "I prefer explanations with diagrams.",
      confidence: 0.99, expires_at: null,
      existing_memory_node_id: null, memory_node_id: null,
      superseded_by_proposal_id: null, superseded_by_memory_id: null,
      memory_was_created: null, before_snapshot: null, after_snapshot: null,
      created_at: "2026-08-16T00:00:00Z", resolved_at: null, undone_at: null,
      sources: [{ id: id(23), owner_id: id(99), proposal_id: id(20), source_message_id: id(24), conversation_id: id(22), message_content: "I prefer explanations with diagrams.", created_at: "2026-08-16T00:00:00Z" }],
      connections: [],
    });
    expect(proposal.kind).toBe("memory_proposal");
  });

  it("parses post-turn Memory extraction events", () => {
    expect(chatEventSchema.parse({ type: "memory.proposed", proposal_id: id(20), ai_run_id: id(21) }).type).toBe("memory.proposed");
    expect(chatEventSchema.parse({ type: "memory.extraction.completed", proposal_ids: [id(20)], error: null }).type).toBe("memory.extraction.completed");
  });
  it("represents stale relationship requests as superseded audit entries", () => {
    const proposal = activityItemSchema.parse({
      kind: "relationship_proposal",
      id: id(1),
      status: "superseded",
      source_node_id: id(2),
      source_title: "BGP Notes",
      target_node_id: id(3),
      target_title: "Cloudflare Interview",
      relationship_type: "supports",
      reason: "Requested in another conversation",
      confidence: 1,
      ai_run_id: id(4),
      conversation_id: id(5),
      edge_id: id(6),
      assertion_id: id(7),
      superseded_by_proposal_id: id(8),
      edge_was_created: false,
      assertion_was_created: false,
      created_at: "2026-08-13T00:00:00Z",
      resolved_at: "2026-08-13T00:01:00Z",
      undone_at: null,
    });

    expect(proposal.kind).toBe("relationship_proposal");
    if (proposal.kind === "relationship_proposal") expect(proposal.status).toBe("superseded");
  });

  it("keeps explicit paths and assertions in streamed evidence", () => {
    const event = chatEventSchema.parse({
      type: "evidence",
      nodes: [id(2), id(3)],
      edges: [id(6)],
      assertions: [id(7)],
      paths: [{ node_ids: [id(2), id(3)], edge_ids: [id(6)] }],
      content: [{ node_id: id(2), content_version: 2 }],
    });

    expect(event.type).toBe("evidence");
    if (event.type === "evidence") expect(event.paths?.[0].edge_ids).toEqual([id(6)]);
  });

  it("tracks bounded historical message and conversation-summary evidence", () => {
    const event = chatEventSchema.parse({
      type: "evidence",
      nodes: [id(5)],
      edges: [],
      messages: [id(9)],
      conversation_summaries: [{ conversation_id: id(5), summary_version: 3 }],
    });

    expect(event.type).toBe("evidence");
    if (event.type === "evidence") {
      expect(event.messages).toEqual([id(9)]);
      expect(event.conversation_summaries?.[0].summary_version).toBe(3);
    }
  });

  it("accepts the early response-ready event used before post-response work finishes", () => {
    const message = {
      id: id(2),
      owner_id: id(4),
      conversation_id: id(1),
      role: "user",
      content: "Question",
      status: "complete",
      evidence: {},
      metadata: {},
      created_at: "2026-08-20T00:00:00Z",
      sequence: 1,
      ai_run_id: null,
    };
    const event = chatEventSchema.parse({
      type: "response.ready",
      conversation_id: id(1),
      message_id: id(5),
      ai_run_id: id(3),
      request_message: message,
      response_message: { ...message, id: id(5), role: "assistant", content: "Answer", sequence: 2, ai_run_id: id(3) },
    });
    expect(event.type).toBe("response.ready");
  });

  it("parses normalized activity pages with backend-authorized actions", () => {
    const page = activityPageSchema.parse({
      items: [{
        kind: "relationship_proposal", id: id(1), status: "pending", state: "pending",
        available_actions: ["approve", "reject"], source_node_id: id(2), source_title: "BGP",
        target_node_id: id(3), target_title: "Homelab", relationship_type: "related_to",
        reason: "Requested by the user", confidence: 1, ai_run_id: id(4), conversation_id: id(5),
        edge_id: null, assertion_id: null, superseded_by_proposal_id: null,
        edge_was_created: null, assertion_was_created: null, created_at: "2026-08-20T00:00:00Z",
        resolved_at: null, undone_at: null,
      }],
      total_count: 1,
      next_cursor: { created_at: "2026-08-20T00:00:00Z", id: id(1) },
    });
    expect(page.items[0].available_actions).toEqual(["approve", "reject"]);
  });

  it("parses rich source details and changed-version markers", () => {
    const evidence = messageEvidenceBundleSchema.parse({
      message_id: id(1),
      nodes: [{ id: id(2), owner_id: id(99), type: "note", title: "BGP", summary: "Routing notes", version: 1, created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-20T00:00:00Z", archived_at: null, content_excerpt: "# BGP", cited_version: 1, current_content_version: 2, changed_since_answer: true }],
      edges: [], assertions: [], messages: [], conversation_summaries: [], paths: [],
      missing: { nodes: [], edges: [], assertions: [], messages: [] },
    });
    expect(evidence.nodes[0].changed_since_answer).toBe(true);
  });
});
