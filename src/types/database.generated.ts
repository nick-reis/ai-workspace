export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type NodeRow = {
  id: string;
  owner_id: string;
  type: "note" | "conversation" | "memory";
  title: string;
  summary: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type NoteRow = {
  node_id: string;
  owner_id: string;
  markdown: string;
  format_version: number;
  content_version: number;
  parsed_at: string | null;
  updated_at: string;
};

type EdgeRow = {
  id: string;
  owner_id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type EdgeAssertionRow = {
  id: string;
  owner_id: string;
  edge_id: string;
  provenance: string;
  actor_id: string | null;
  source_node_id: string | null;
  source_message_id: string | null;
  source_ai_run_id: string | null;
  origin_key: string | null;
  reason: string | null;
  confidence: number | null;
  source_locator: Json;
  status: string;
  created_at: string;
  updated_at: string;
  retracted_at: string | null;
};

type MessageRow = {
  id: string;
  owner_id: string;
  conversation_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  status: "pending" | "streaming" | "complete" | "error";
  evidence: Json;
  metadata: Json;
  created_at: string;
  sequence: number;
  ai_run_id: string | null;
};

type GraphChangeRow = {
  id: string;
  owner_id: string;
  ai_run_id: string | null;
  assertion_id: string | null;
  edge_id: string | null;
  node_id: string | null;
  proposal_id: string | null;
  memory_proposal_id: string | null;
  operation: "create_node" | "update_node" | "archive_node" | "restore_node" | "update_note" | "create_assertion" | "retract_assertion" | "request_relationship";
  actor: "user" | "ai" | "system" | "markdown";
  approval_state: "proposed" | "applied" | "rejected" | "superseded" | "undone";
  reason: string | null;
  confidence: number | null;
  before_snapshot: Json | null;
  after_snapshot: Json | null;
  idempotency_key: string | null;
  created_at: string;
  undone_at: string | null;
};

type ReadTable<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      nodes: ReadTable<NodeRow>;
      notes: ReadTable<NoteRow>;
      memories: ReadTable<{
        node_id: string;
        owner_id: string;
        semantic_key: string;
        kind: "fact" | "preference" | "goal" | "constraint" | "skill";
        statement: string;
        confidence: number;
        expires_at: string | null;
        current_revision: number;
        confirmed_at: string;
        created_at: string;
        updated_at: string;
      }>;
      memory_revisions: ReadTable<{
        id: string;
        owner_id: string;
        memory_node_id: string;
        revision: number;
        title: string;
        kind: "fact" | "preference" | "goal" | "constraint" | "skill";
        statement: string;
        confidence: number;
        expires_at: string | null;
        source_ai_run_id: string | null;
        restored_from_revision: number | null;
        created_at: string;
      }>;
      memory_revision_sources: ReadTable<{
        id: string;
        owner_id: string;
        revision_id: string;
        source_message_id: string;
        conversation_id: string;
        ai_run_id: string | null;
        created_at: string;
      }>;
      memory_proposals: ReadTable<{
        id: string;
        owner_id: string;
        ai_run_id: string;
        conversation_id: string;
        semantic_key: string;
        action: "create" | "update";
        status: "pending" | "approved" | "rejected" | "superseded";
        title: string;
        kind: "fact" | "preference" | "goal" | "constraint" | "skill";
        statement: string;
        confidence: number;
        expires_at: string | null;
        existing_memory_node_id: string | null;
        memory_node_id: string | null;
        superseded_by_proposal_id: string | null;
        superseded_by_memory_id: string | null;
        memory_was_created: boolean | null;
        context_assertion_id: string | null;
        before_snapshot: Json | null;
        after_snapshot: Json | null;
        created_at: string;
        resolved_at: string | null;
        undone_at: string | null;
      }>;
      memory_proposal_connections: ReadTable<{
        id: string;
        owner_id: string;
        proposal_id: string;
        existing_node_id: string;
        direction: "memory_to_node" | "node_to_memory";
        relationship_type: string;
        reason: string;
        confidence: number | null;
        selected: boolean;
        applied_edge_id: string | null;
        applied_assertion_id: string | null;
        edge_was_created: boolean | null;
        assertion_was_created: boolean | null;
        created_at: string;
      }>;
      edges: ReadTable<EdgeRow>;
      edge_assertions: ReadTable<EdgeAssertionRow>;
      messages: ReadTable<MessageRow>;
      conversation_summaries: ReadTable<{
        conversation_id: string;
        owner_id: string;
        summary: string;
        topics: string[];
        decisions: Json;
        open_loops: Json;
        salient_facts: Json;
        message_count: number;
        through_message_id: string | null;
        through_message_sequence: number | null;
        through_message_created_at: string | null;
        source_hash: string | null;
        summary_version: number;
        model: string | null;
        status: "stale" | "current" | "error";
        last_error: string | null;
        generated_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      graph_changes: ReadTable<GraphChangeRow>;
      relationship_proposals: ReadTable<{
        id: string;
        owner_id: string;
        ai_run_id: string;
        source_message_id: string | null;
        source_node_id: string;
        target_node_id: string;
        relationship_type: string;
        semantic_key: string;
        reason: string | null;
        confidence: number | null;
        status: "pending" | "approved" | "rejected" | "superseded";
        edge_id: string | null;
        assertion_id: string | null;
        superseded_by_proposal_id: string | null;
        edge_was_created: boolean | null;
        assertion_was_created: boolean | null;
        created_at: string;
        resolved_at: string | null;
        undone_at: string | null;
      }>;
      relationship_types: ReadTable<{
        name: string;
        label: string;
        inverse_label: string | null;
        description: string;
        is_symmetric: boolean;
        is_hierarchical: boolean;
        must_be_acyclic: boolean;
        allows_self_reference: boolean;
        allowed_source_types: string[] | null;
        allowed_target_types: string[] | null;
        created_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      create_entity: {
        Args: {
          p_type: string;
          p_title: string;
          p_summary?: string | null;
          p_markdown?: string | null;
          p_actor?: string;
          p_ai_run_id?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: Json;
      };
      create_note: {
        Args: {
          p_title: string;
          p_summary?: string | null;
          p_markdown?: string;
          p_links?: Json;
          p_actor?: string;
          p_ai_run_id?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: Json;
      };
      create_ai_entity_resolving_identity: {
        Args: {
          p_type: string;
          p_title: string;
          p_summary?: string | null;
          p_markdown?: string | null;
          p_ai_run_id?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: Json;
      };
      update_entity: {
        Args: { p_node_id: string; p_title: string; p_summary: string; p_expected_version: number };
        Returns: Json;
      };
      update_note: {
        Args: { p_node_id: string; p_markdown: string; p_expected_content_version: number; p_links?: Json };
        Returns: Json;
      };
      create_edge_assertion: {
        Args: {
          p_source_node_id: string;
          p_target_node_id: string;
          p_relationship_type: string;
          p_provenance?: string;
          p_reason?: string | null;
          p_confidence?: number | null;
          p_origin_key?: string | null;
          p_source_locator?: Json;
          p_ai_run_id?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: Json;
      };
      retract_edge_assertion: {
        Args: { p_assertion_id: string; p_reason?: string | null; p_ai_run_id?: string | null };
        Returns: Json;
      };
      search_nodes: {
        Args: { p_query?: string; p_types?: string[] | null; p_limit?: number };
        Returns: NodeRow[];
      };
      search_graph: {
        Args: { p_query?: string; p_types?: string[] | null; p_limit?: number };
        Returns: Json;
      };
      get_activity_feed: { Args: { p_limit?: number }; Returns: Json };
      get_activity_page: {
        Args: {
          p_limit?: number;
          p_before_created_at?: string | null;
          p_before_id?: string | null;
          p_state?: string | null;
          p_ai_run_id?: string | null;
        };
        Returns: Json;
      };
      get_message_evidence: { Args: { p_message_id: string }; Returns: Json };
      get_conversation_summary: { Args: { p_conversation_id: string }; Returns: Json };
      search_conversation_messages: { Args: { p_conversation_id: string; p_query: string; p_limit?: number }; Returns: Json };
      get_message_context: { Args: { p_message_id: string; p_before?: number; p_after?: number }; Returns: Json };
      save_conversation_summary: { Args: { p_conversation_id: string; p_expected_previous_sequence: number; p_summary: string; p_topics: string[]; p_decisions: Json; p_open_loops: Json; p_salient_facts: Json; p_through_message_id: string; p_through_message_sequence: number; p_through_message_created_at: string; p_source_hash: string; p_model: string }; Returns: Json };
      get_node_bundle: { Args: { p_node_id: string }; Returns: Json };
      get_neighborhood: {
        Args: { p_node_id: string; p_relationship_types?: string[] | null; p_direction?: string; p_limit?: number };
        Returns: Json;
      };
      traverse_graph: {
        Args: {
          p_start_node_ids: string[];
          p_max_depth?: number;
          p_relationship_types?: string[] | null;
          p_direction?: string;
          p_node_limit?: number;
          p_edge_limit?: number;
        };
        Returns: Json;
      };
      undo_graph_change: { Args: { p_change_id: string }; Returns: Json };
      resolve_graph_change: { Args: { p_change_id: string; p_approve: boolean }; Returns: Json };
      resolve_relationship_proposal: { Args: { p_proposal_id: string; p_approve: boolean }; Returns: Json };
      undo_relationship_proposal: { Args: { p_proposal_id: string }; Returns: Json };
      get_memory_proposal: { Args: { p_proposal_id: string }; Returns: Json };
      update_memory_proposal: { Args: { p_proposal_id: string; p_title: string; p_kind: string; p_statement: string; p_confidence: number; p_expires_at: string | null; p_connections: Json }; Returns: Json };
      resolve_memory_proposal: { Args: { p_proposal_id: string; p_approve: boolean }; Returns: Json };
      undo_memory_proposal: { Args: { p_proposal_id: string }; Returns: Json };
      search_memory_context: { Args: { p_query: string; p_limit?: number }; Returns: Json };
      resolve_explicit_node_mentions: { Args: { p_text: string; p_limit?: number }; Returns: Json };
      record_conversation_context: { Args: { p_conversation_id: string; p_source_message_id: string; p_text: string; p_selected_node_id?: string | null }; Returns: Json };
      reset_workspace_data: { Args: { p_confirmation: string }; Returns: Json };
      delete_entity_permanently: { Args: { p_node_id: string; p_confirmation: string }; Returns: Json };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
