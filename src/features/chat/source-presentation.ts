import type { MessageEvidenceBundle } from "@/types/graph";

export function dedupeConversationSummaries(
  nodes: MessageEvidenceBundle["nodes"],
  summaries: MessageEvidenceBundle["conversation_summaries"],
) {
  const conversationNodeIds = new Set(nodes.filter((node) => node.type === "conversation").map((node) => node.id));
  return summaries.filter((summary) => !conversationNodeIds.has(summary.conversation_id));
}
