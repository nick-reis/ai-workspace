import { supabase } from "@/lib/supabase";
import { unwrapSupabaseResult } from "@/lib/supabase-result";
import {
  activityPageSchema,
  messageEvidenceBundleSchema,
  type ActivityAction,
  type ActivityCursor,
  type ActivityItem,
  type ActivityPage,
  type ActivityState,
  type MessageEvidenceBundle,
} from "@/types/graph";

export const activityKeys = {
  all: ["activity"] as const,
  pages: (state: ActivityState | null) => ["activity", "pages", state ?? "all"] as const,
  pendingCount: ["activity", "pending-count"] as const,
  pendingPage: ["activity", "pending-page"] as const,
  run: (aiRunId: string | null) => ["activity", "run", aiRunId ?? "none"] as const,
  evidence: (messageId: string | null) => ["activity", "evidence", messageId ?? "none"] as const,
};

export async function listActivityPage(input: {
  limit?: number;
  cursor?: ActivityCursor | null;
  state?: ActivityState | null;
  aiRunId?: string | null;
} = {}): Promise<ActivityPage> {
  const result = await supabase.rpc("get_activity_page", {
    p_limit: input.limit ?? 30,
    p_before_created_at: input.cursor?.created_at ?? null,
    p_before_id: input.cursor?.id ?? null,
    p_state: input.state ?? null,
    p_ai_run_id: input.aiRunId ?? null,
  });
  return activityPageSchema.parse(unwrapSupabaseResult(result, "Could not load activity."));
}

export async function listRunActivity(aiRunId: string): Promise<ActivityItem[]> {
  return (await listActivityPage({ limit: 50, aiRunId })).items;
}

export async function getPendingActivityCount(): Promise<number> {
  return (await listActivityPage({ limit: 1, state: "pending" })).total_count;
}

export async function getMessageEvidence(messageId: string): Promise<MessageEvidenceBundle> {
  const result = await supabase.rpc("get_message_evidence", { p_message_id: messageId });
  return messageEvidenceBundleSchema.parse(unwrapSupabaseResult(result, "Could not load response sources."));
}

export async function performActivityAction(input: {
  item: ActivityItem;
  action: ActivityAction;
}) {
  const { item, action } = input;
  if (!item.available_actions.includes(action)) throw new Error("This action is no longer available.");

  if (action === "undo") {
    const result = item.kind === "memory_proposal"
      ? await supabase.rpc("undo_memory_proposal", { p_proposal_id: item.id })
      : item.kind === "relationship_proposal"
        ? await supabase.rpc("undo_relationship_proposal", { p_proposal_id: item.id })
        : await supabase.rpc("undo_graph_change", { p_change_id: item.id });
    return unwrapSupabaseResult(result, "Could not undo the activity.");
  }

  const approve = action === "approve";
  const result = item.kind === "memory_proposal"
    ? await supabase.rpc("resolve_memory_proposal", { p_proposal_id: item.id, p_approve: approve })
    : item.kind === "relationship_proposal"
      ? await supabase.rpc("resolve_relationship_proposal", { p_proposal_id: item.id, p_approve: approve })
      : await supabase.rpc("resolve_graph_change", { p_change_id: item.id, p_approve: approve });
  return unwrapSupabaseResult(result, "Could not resolve the proposal.");
}

export function activityState(item: ActivityItem): ActivityState {
  if (item.state) return item.state;
  if (item.undone_at) return "undone";
  if (item.kind === "graph_change") return item.approval_state === "proposed" ? "pending" : item.approval_state;
  return item.status === "approved" ? "applied" : item.status;
}

export function hasMessageEvidence(message: { evidence: unknown }) {
  const evidence = message.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  return ["nodes", "searched_nodes", "edges", "assertions", "paths", "messages", "searched_messages", "conversation_summaries"]
    .some((key) => Array.isArray((evidence as Record<string, unknown>)[key]) && ((evidence as Record<string, unknown>)[key] as unknown[]).length > 0);
}
