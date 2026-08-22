import { supabase } from "@/lib/supabase";
import { unwrapSupabaseResult } from "@/lib/supabase-result";
import { chatEventSchema, type ChatEvent, type StreamedChatMessage } from "@/types/graph";

export type Conversation = {
  id: string;
  title: string;
  summary: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = StreamedChatMessage;

export const CONVERSATION_PAGE_SIZE = 30;

export async function listConversationPage(offset: number): Promise<{
  conversations: Conversation[];
  nextOffset: number | undefined;
}> {
  const result = await supabase.from("nodes")
    .select("id,title,summary,version,created_at,updated_at")
    .eq("type", "conversation")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + CONVERSATION_PAGE_SIZE - 1);
  const conversations = unwrapSupabaseResult(result, "Could not load conversations.");
  return {
    conversations,
    nextOffset: conversations.length === CONVERSATION_PAGE_SIZE
      ? offset + CONVERSATION_PAGE_SIZE
      : undefined,
  };
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const result = await supabase.from("messages").select("*").eq("conversation_id", conversationId).order("sequence");
  return unwrapSupabaseResult(result, "Could not load messages.");
}

export async function renameConversation(conversation: Conversation, title: string) {
  const result = await supabase.rpc("update_entity", {
    p_node_id: conversation.id,
    p_title: title,
    p_summary: conversation.summary ?? "",
    p_expected_version: conversation.version,
  });
  return unwrapSupabaseResult(result, "Could not rename the conversation.");
}

export async function deleteConversation(conversationId: string) {
  const result = await supabase.rpc("delete_entity_permanently", { p_node_id: conversationId, p_confirmation: "DELETE" });
  return unwrapSupabaseResult(result, "Could not delete the conversation.");
}

function eventBlocks(buffer: string) {
  const blocks = buffer.split(/\r?\n\r?\n/);
  return { complete: blocks.slice(0, -1), remainder: blocks[blocks.length - 1] ?? "" };
}

function parseBlock(block: string): ChatEvent | null {
  const payload = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  if (!payload) return null;
  return chatEventSchema.parse(JSON.parse(payload));
}

export async function streamGraphChat(input: {
  message: string;
  conversationId: string | null;
  signal: AbortSignal;
  onEvent: (event: ChatEvent) => void;
}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) throw new Error(sessionError?.message ?? "You must be signed in to chat.");
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/graph-chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: input.message,
      conversation_id: input.conversationId ?? undefined,
    }),
    signal: input.signal,
  });
  if (!response.ok) throw new Error((await response.text()) || `Chat request failed (${response.status}).`);
  if (!response.body) throw new Error("The chat response did not include a stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parsed = eventBlocks(buffer);
    buffer = parsed.remainder;
    for (const block of parsed.complete) {
      const event = parseBlock(block);
      if (event) input.onEvent(event);
    }
    if (done) break;
  }
  const finalEvent = parseBlock(buffer);
  if (finalEvent) input.onEvent(finalEvent);
}
