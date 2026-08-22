import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";
import { normalizeConversationTitle } from "../_shared/conversation-title.ts";
import {
  collectEvidence,
  createEvidence,
  finalizeNodeCitations,
  toEvidencePayload,
} from "../_shared/evidence.ts";
import {
  buildExplicitNodeReferences,
  toolChoiceForExplicitReferences,
  type ExplicitNodeReference,
} from "../_shared/explicit-node-references.ts";
import {
  READ_TOOL_NAMES,
  parseGraphToolArguments,
  toolsForModelRound,
} from "../_shared/graph-tools.ts";
import {
  CONVERSATION_SUMMARY_INSTRUCTIONS,
  CONVERSATION_TITLE_INSTRUCTIONS,
  FINAL_SYNTHESIS_INSTRUCTION,
  GRAPH_REASONING_INSTRUCTIONS,
  MEMORY_EXTRACTION_INSTRUCTIONS,
} from "../_shared/prompts.ts";
import {
  isMemoryStatementGrounded,
  isMeaningfulRelationshipReason,
  mergeExplicitMentionConnections,
  selectEligibleMemorySourceIds,
  shouldExtractMemoryForTurn,
} from "../_shared/proposal-policy.ts";

const MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.4-mini";
const SUMMARY_MODEL = Deno.env.get("OPENAI_SUMMARY_MODEL") ?? MODEL;
const SUMMARY_POLICY_VERSION = 2;
const SUMMARY_IMPLEMENTATION_ID = `${SUMMARY_MODEL}:policy-v${SUMMARY_POLICY_VERSION}`;
const EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
const MAX_MODEL_ROUNDS = 12;
const MAX_TOOL_CALLS = 24;

type FunctionCall = { type: "function_call"; name: string; arguments: string; call_id: string };
type OpenAIOutput = FunctionCall | { type: string; content?: unknown[]; [key: string]: unknown };
type JsonRecord = Record<string, unknown>;
type OpenAIResponseResult = { output?: OpenAIOutput[]; output_text?: string };

async function createOpenAIResponse(
  openAiKey: string,
  requestBody: JsonRecord,
  requestName: string,
): Promise<OpenAIResponseResult> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) throw new Error(`${requestName} API error ${response.status}: ${await response.text()}`);
  return await response.json() as OpenAIResponseResult;
}

function send(controller: ReadableStreamDefaultController, event: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function parseWikiLinks(markdown: string) {
  return Array.from(markdown.matchAll(/\[\[([^\n|[\]]+)(?:\|[^\n[\]]+)?\]\]/g), (match) => ({
    label: match[1].trim(), start: match.index, end: match.index + match[0].length,
  })).filter((link) => link.label.length > 0);
}

async function callRpc(client: SupabaseClient, name: string, args: JsonRecord) {
  const { data, error } = await client.rpc(name, args);
  if (error) return { error: error.message, code: error.code };
  return data;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createEmbeddings(openAiKey: string, inputs: string[]) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs, encoding_format: "float" }),
  });
  if (!response.ok) throw new Error(`Embedding API error ${response.status}`);
  const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
  return (payload.data ?? []).sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

async function refreshEmbeddings(admin: SupabaseClient, ownerId: string, openAiKey: string) {
  const { data: nodes } = await admin.from("nodes").select("id,title,summary,updated_at,type").eq("owner_id", ownerId).is("archived_at", null).neq("type", "conversation").order("updated_at", { ascending: false }).limit(40);
  const nodeRows = asRecords(nodes);
  if (!nodeRows.length) return;
  const ids = nodeRows.map((node) => String(node.id));
  const [{ data: notes }, { data: chunks }] = await Promise.all([
    admin.from("notes").select("node_id,markdown,content_version").eq("owner_id", ownerId).in("node_id", ids),
    admin.from("node_content_chunks").select("node_id,content_hash").eq("owner_id", ownerId).in("node_id", ids),
  ]);
  const notesByNode = new Map(asRecords(notes).map((note) => [String(note.node_id), note]));
  const hashesByNode = new Map(asRecords(chunks).map((chunk) => [String(chunk.node_id), String(chunk.content_hash)]));
  const stale: Array<{ nodeId: string; content: string; hash: string }> = [];
  for (const node of nodeRows) {
    const note = notesByNode.get(String(node.id));
    const content = [node.title, node.summary, note?.markdown].filter((part) => typeof part === "string" && part.trim()).join("\n\n").slice(0, 12_000);
    const hash = await sha256(`${EMBEDDING_MODEL}\n${content}`);
    if (hashesByNode.get(String(node.id)) !== hash) stale.push({ nodeId: String(node.id), content, hash });
    if (stale.length >= 12) break;
  }
  if (!stale.length) return;
  const embeddings = await createEmbeddings(openAiKey, stale.map((item) => item.content));
  if (embeddings.length !== stale.length) return;
  await admin.from("node_content_chunks").delete().eq("owner_id", ownerId).in("node_id", stale.map((item) => item.nodeId));
  await admin.from("node_content_chunks").insert(stale.map((item, index) => ({
    owner_id: ownerId,
    node_id: item.nodeId,
    chunk_index: 0,
    content: item.content,
    content_hash: item.hash,
    embedding_model: EMBEDDING_MODEL,
    embedding: embeddings[index],
  })));
}

async function rankedSearch(client: SupabaseClient, admin: SupabaseClient, ownerId: string, openAiKey: string, args: JsonRecord) {
  const lexical = await callRpc(client, "search_graph", { p_query: args.query, p_types: args.types, p_limit: Math.min(Number(args.limit) * 2, 50) });
  let semantic: unknown = [];
  if (String(args.query).trim()) {
    try {
      await refreshEmbeddings(admin, ownerId, openAiKey);
      const [embedding] = await createEmbeddings(openAiKey, [String(args.query)]);
      if (embedding) semantic = await callRpc(client, "match_node_embeddings", { p_embedding: `[${embedding.join(",")}]`, p_types: args.types, p_limit: Math.min(Number(args.limit) * 2, 30) });
    } catch {
      semantic = [];
    }
  }
  const ranked = new Map<string, JsonRecord & { retrieval_score: number; retrieval_evidence: string[] }>();
  for (const item of asRecords(lexical)) {
    const id = String(item.id);
    ranked.set(id, { ...item, retrieval_score: Number(item.rank ?? 0), retrieval_evidence: [String(item.match_reason ?? "lexical")] });
  }
  for (const item of asRecords(semantic)) {
    const id = String(item.id);
    const score = Number(item.similarity ?? 0) * 6;
    const existing = ranked.get(id);
    if (existing) {
      existing.retrieval_score += score;
      existing.retrieval_evidence.push("semantic_similarity");
    } else ranked.set(id, { ...item, retrieval_score: score, retrieval_evidence: ["semantic_similarity"] });
  }
  const now = Date.now();
  for (const item of ranked.values()) {
    const modifiedAt = typeof item.updated_at === "string" ? Date.parse(item.updated_at) : Number.NaN;
    if (!Number.isNaN(modifiedAt)) {
      const ageDays = Math.max(0, (now - modifiedAt) / 86_400_000);
      const recencyBoost = 1.25 * Math.exp(-ageDays / 45);
      item.retrieval_score += recencyBoost;
      item.retrieval_evidence.push(`modified_at:${item.updated_at}`);
    }
    if (typeof item.created_at === "string") item.retrieval_evidence.push(`created_at:${item.created_at}`);
  }
  return [...ranked.values()]
    .sort((a, b) => b.retrieval_score - a.retrieval_score)
    .slice(0, Number(args.limit))
    .map((item) => {
      const candidate = { ...item };
      delete candidate.content_excerpt;
      return candidate;
    });
}

async function prefetchMemoryContext(
  client: SupabaseClient,
  admin: SupabaseClient,
  ownerId: string,
  openAiKey: string,
  query: string,
) {
  const ranked = await rankedSearch(client, admin, ownerId, openAiKey, {
    query,
    types: ["memory"],
    limit: 8,
  });
  const candidates = asRecords(ranked).slice(0, 8);
  const ids = candidates.map((item) => String(item.id));
  if (!ids.length) return [];
  const { data } = await admin.from("memories")
    .select("node_id,semantic_key,kind,statement,confidence,expires_at,current_revision")
    .eq("owner_id", ownerId)
    .in("node_id", ids);
  const byId = new Map(asRecords(data).map((memory) => [String(memory.node_id), memory]));
  return candidates.flatMap((candidate) => {
    const memory = byId.get(String(candidate.id));
    if (!memory) return [];
    if (typeof memory.expires_at === "string" && Date.parse(memory.expires_at) <= Date.now()) return [];
    return [{
      id: candidate.id,
      title: candidate.title,
      semantic_key: memory.semantic_key,
      kind: memory.kind,
      statement: memory.statement,
      confidence: memory.confidence,
      expires_at: memory.expires_at,
      current_revision: memory.current_revision,
      retrieval_score: candidate.retrieval_score,
      retrieval_evidence: candidate.retrieval_evidence,
    }];
  }).slice(0, 8);
}

async function resolveExplicitNodeReferences(
  client: SupabaseClient,
  message: string,
): Promise<ExplicitNodeReference[]> {
  const resolved = await callRpc(client, "resolve_explicit_node_mentions", {
    p_text: message,
    p_limit: 8,
  });
  return buildExplicitNodeReferences(resolved);
}

async function executeTool(
  call: FunctionCall,
  client: SupabaseClient,
  admin: SupabaseClient,
  ownerId: string,
  aiRunId: string,
  requestMessageId: string,
  openAiKey: string,
) {
  const parsed = parseGraphToolArguments(call.name, call.arguments);
  if (!parsed.ok) return { error: parsed.error };
  const args = parsed.args;
  switch (call.name) {
    case "graph_search_nodes":
      return rankedSearch(client, admin, ownerId, openAiKey, args);
    case "graph_get_node": {
      const bundle = await callRpc(client, "get_node_bundle", { p_node_id: args.node_id });
      if (!args.include_content && isRecord(bundle) && "note" in bundle) {
        const safeBundle = structuredClone(bundle);
        if (isRecord(safeBundle.note)) safeBundle.note.markdown = "[content omitted; use notes_get_content]";
        return safeBundle;
      }
      return bundle;
    }
    case "graph_get_neighbors":
      return callRpc(client, "get_neighborhood", { p_node_id: args.node_id, p_relationship_types: args.relationship_types, p_direction: args.direction, p_limit: args.limit });
    case "graph_traverse":
      return callRpc(client, "traverse_graph", { p_start_node_ids: args.start_node_ids, p_max_depth: args.max_depth, p_relationship_types: args.relationship_types, p_direction: args.direction, p_node_limit: args.node_limit, p_edge_limit: args.edge_limit });
    case "conversations_get_summary": {
      let result = await callRpc(client, "get_conversation_summary", { p_conversation_id: args.conversation_id });
      const existingSummary = isRecord(result) && isRecord(result.summary) ? result.summary : null;
      const needsRefresh = isRecord(result)
        && (result.needs_refresh === true || existingSummary?.model !== SUMMARY_IMPLEMENTATION_ID);
      if (needsRefresh) {
        try {
          for (let batch = 0; batch < 8; batch += 1) {
            const refreshed = await refreshConversationSummary(admin, ownerId, String(args.conversation_id), openAiKey);
            if (!refreshed || refreshed.status !== "stale") break;
          }
          result = await callRpc(client, "get_conversation_summary", { p_conversation_id: args.conversation_id });
        } catch (error) {
          if (isRecord(result)) result.summary_refresh_error = error instanceof Error ? error.message : "Summary refresh failed.";
        }
      }
      return result;
    }
    case "conversations_search_messages":
      return callRpc(client, "search_conversation_messages", { p_conversation_id: args.conversation_id, p_query: args.query, p_limit: args.limit });
    case "conversations_get_message_context":
      return callRpc(client, "get_message_context", { p_message_id: args.message_id, p_before: args.before, p_after: args.after });
    case "graph_propose_relationship":
      if (!isMeaningfulRelationshipReason(args.reason)) {
        return { status: "skipped", error: "relationship_reason_is_not_meaningful" };
      }
      return callRpc(client, "propose_relationship", { p_source_node_id: args.source_node_id, p_target_node_id: args.target_node_id, p_relationship_type: args.relationship_type, p_reason: args.reason, p_confidence: args.confidence, p_ai_run_id: aiRunId, p_source_message_id: requestMessageId });
    case "graph_retract_assertion": {
      const { data, error } = await admin.from("graph_changes").insert({ owner_id: ownerId, ai_run_id: aiRunId, assertion_id: args.assertion_id, operation: "retract_assertion", actor: "ai", approval_state: "proposed", reason: args.reason, after_snapshot: { assertion_id: args.assertion_id, reason: args.reason, source_message_id: requestMessageId } }).select().single();
      return error ? { error: error.message } : { status: "confirmation_required", change: data };
    }
    case "notes_get_content":
      return callRpc(client, "get_node_bundle", { p_node_id: args.node_id });
    case "notes_create":
      return callRpc(client, "create_note", { p_title: args.title, p_summary: args.summary, p_markdown: args.markdown, p_links: parseWikiLinks(String(args.markdown)), p_actor: "ai", p_ai_run_id: aiRunId, p_idempotency_key: args.idempotency_key });
    case "notes_update": {
      const markdown = String(args.markdown);
      const { data, error } = await admin.from("graph_changes").insert({ owner_id: ownerId, ai_run_id: aiRunId, node_id: args.node_id, operation: "update_note", actor: "ai", approval_state: "proposed", reason: args.reason, after_snapshot: { markdown, expected_content_version: args.expected_content_version, links: parseWikiLinks(markdown), source_message_id: requestMessageId } }).select().single();
      return error ? { error: error.message } : { status: "confirmation_required", change: data };
    }
    default:
      return { error: "unknown_tool" };
  }
}

function outputText(result: { output?: OpenAIOutput[]; output_text?: string }) {
  if (result.output_text) return result.output_text;
  return (result.output ?? []).flatMap((item) => item.type === "message" && Array.isArray(item.content) ? item.content : [])
    .filter((item): item is { text: string } => isRecord(item) && typeof item.text === "string")
    .map((item) => item.text).join("");
}

const conversationTitleSchema = {
  type: "object",
  properties: { title: { type: "string", minLength: 1, maxLength: 80 } },
  required: ["title"],
  additionalProperties: false,
} as const;

async function generateConversationTitle(
  openAiKey: string,
  openingMessage: string,
  firstAnswer: string,
) {
  const result = await createOpenAIResponse(openAiKey, {
    model: MODEL,
    store: false,
    reasoning: { effort: "low" },
    instructions: CONVERSATION_TITLE_INSTRUCTIONS,
    input: [{
      role: "user",
      content: JSON.stringify({
        opening_message: openingMessage.slice(0, 2_000),
        first_answer: firstAnswer.slice(0, 2_000),
      }),
    }],
    text: {
      format: {
        type: "json_schema",
        name: "conversation_title",
        strict: true,
        schema: conversationTitleSchema,
      },
    },
  }, "Conversation title");
  const rawText = outputText(result);
  if (!rawText) return normalizeConversationTitle(null, openingMessage);
  const parsed = JSON.parse(rawText) as JsonRecord;
  return normalizeConversationTitle(parsed.title, openingMessage);
}

const summarySchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    retrieval_keywords: { type: "array", items: { type: "string" }, maxItems: 12, description: "Private search terms only; never user tags, graph nodes, or relationships." },
    decisions: {
      type: "array", maxItems: 20,
      items: {
        type: "object",
        properties: { statement: { type: "string" }, message_ids: { type: "array", items: { type: "string" }, maxItems: 8 } },
        required: ["statement", "message_ids"], additionalProperties: false,
      },
    },
    open_loops: {
      type: "array", maxItems: 20,
      items: {
        type: "object",
        properties: { statement: { type: "string" }, message_ids: { type: "array", items: { type: "string" }, maxItems: 8 } },
        required: ["statement", "message_ids"], additionalProperties: false,
      },
    },
    salient_facts: {
      type: "array", maxItems: 30,
      items: {
        type: "object",
        properties: { statement: { type: "string" }, message_ids: { type: "array", items: { type: "string" }, maxItems: 8 } },
        required: ["statement", "message_ids"], additionalProperties: false,
      },
    },
  },
  required: ["summary", "retrieval_keywords", "decisions", "open_loops", "salient_facts"],
  additionalProperties: false,
} as const;

function normalizeClaims(value: unknown, allowedMessageIds: Set<string>) {
  return asRecords(value).slice(0, 30).map((claim) => ({
    statement: String(claim.statement ?? "").trim().slice(0, 600),
    message_ids: Array.isArray(claim.message_ids)
      ? claim.message_ids.filter((id): id is string => typeof id === "string" && allowedMessageIds.has(id)).slice(0, 8)
      : [],
  })).filter((claim) => claim.statement.length > 0);
}

async function refreshConversationSummary(
  admin: SupabaseClient,
  ownerId: string,
  conversationId: string,
  openAiKey: string,
) {
  const { data: current } = await admin.from("conversation_summaries").select("*").eq("owner_id", ownerId).eq("conversation_id", conversationId).maybeSingle();
  const rebuildForPolicy = Boolean(current) && current?.model !== SUMMARY_IMPLEMENTATION_ID;
  const afterSequence = rebuildForPolicy ? 0 : Number(current?.through_message_sequence ?? 0);
  const { data: newMessages, error: messagesError } = await admin.from("messages")
    .select("id,sequence,role,content,created_at")
    .eq("owner_id", ownerId)
    .eq("conversation_id", conversationId)
    .gt("sequence", afterSequence)
    .order("sequence", { ascending: true })
    .limit(41);
  if (messagesError) throw new Error(`Summary message query failed: ${messagesError.message}`);
  const pendingRows = asRecords(newMessages);
  const messageRows = pendingRows.slice(0, 40);
  if (!messageRows.length) return current;

  const summaryBase = rebuildForPolicy ? null : current;
  const previousClaims = [summaryBase?.decisions, summaryBase?.open_loops, summaryBase?.salient_facts]
    .flatMap((items) => asRecords(items))
    .flatMap((claim) => Array.isArray(claim.message_ids) ? claim.message_ids : [])
    .filter((id): id is string => typeof id === "string");
  const allowedMessageIds = new Set<string>([
    ...previousClaims,
    ...messageRows.map((row) => String(row.id)),
  ]);
  const summaryInput = {
    previous: summaryBase ? {
      summary: summaryBase.summary,
      retrieval_keywords: summaryBase.topics,
      decisions: summaryBase.decisions,
      open_loops: summaryBase.open_loops,
      salient_facts: summaryBase.salient_facts,
    } : null,
    new_messages: messageRows.map((row) => ({
      id: row.id,
      sequence: row.sequence,
      role: row.role,
      created_at: row.created_at,
      content: String(row.content ?? "").slice(0, 4_000),
    })),
  };
  const result = await createOpenAIResponse(openAiKey, {
    model: SUMMARY_MODEL,
    store: false,
    reasoning: { effort: "low" },
    instructions: CONVERSATION_SUMMARY_INSTRUCTIONS,
    input: [{ role: "user", content: JSON.stringify(summaryInput) }],
    text: { format: { type: "json_schema", name: "conversation_summary", strict: true, schema: summarySchema } },
  }, "Conversation summary");
  const rawText = outputText(result);
  if (!rawText) throw new Error("Conversation summary returned no structured output.");
  const parsed = JSON.parse(rawText) as JsonRecord;
  const lastMessage = messageRows.at(-1)!;
  const normalized = {
    summary: String(parsed.summary ?? "").trim().slice(0, 4_000),
    topics: Array.isArray(parsed.retrieval_keywords) ? parsed.retrieval_keywords.filter((keyword): keyword is string => typeof keyword === "string").map((keyword) => keyword.trim().slice(0, 120)).filter(Boolean).slice(0, 12) : [],
    decisions: normalizeClaims(parsed.decisions, allowedMessageIds),
    open_loops: normalizeClaims(parsed.open_loops, allowedMessageIds),
    salient_facts: normalizeClaims(parsed.salient_facts, allowedMessageIds),
  };
  const sourceHash = await sha256(JSON.stringify({ previous_hash: summaryBase?.source_hash ?? null, messages: summaryInput.new_messages }));
  const { data: saved, error: saveError } = await admin.rpc("save_conversation_summary", {
    p_conversation_id: conversationId,
    p_expected_previous_sequence: Number(current?.through_message_sequence ?? 0),
    p_summary: normalized.summary,
    p_topics: normalized.topics,
    p_decisions: normalized.decisions,
    p_open_loops: normalized.open_loops,
    p_salient_facts: normalized.salient_facts,
    p_through_message_id: lastMessage.id,
    p_through_message_sequence: lastMessage.sequence,
    p_through_message_created_at: lastMessage.created_at,
    p_source_hash: sourceHash,
    p_model: SUMMARY_IMPLEMENTATION_ID,
  });
  if (saveError) throw new Error(`Conversation summary save failed: ${saveError.message}`);
  return saved;
}

const memoryExtractionSchema = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          semantic_key: { type: "string", minLength: 3, maxLength: 120 },
          title: { type: "string", minLength: 1, maxLength: 240 },
          kind: { type: "string", enum: ["fact", "preference", "goal", "constraint", "skill"] },
          statement: { type: "string", minLength: 1, maxLength: 2000 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          expires_at: { type: ["string", "null"] },
          source_message_ids: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
          connections: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                existing_node_id: { type: "string" },
                direction: { type: "string", enum: ["memory_to_node", "node_to_memory"] },
                relationship_type: { type: "string", enum: ["related_to", "references", "about", "part_of", "supports", "derived_from"] },
                reason: { type: "string", minLength: 1, maxLength: 1000 },
                confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
                selected: { type: "boolean" },
              },
              required: ["existing_node_id", "direction", "relationship_type", "reason", "confidence", "selected"],
              additionalProperties: false,
            },
          },
        },
        required: ["semantic_key", "title", "kind", "statement", "confidence", "expires_at", "source_message_ids", "connections"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

const secretMemoryPattern = /\b(password|passcode|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|private[ _-]?key|recovery[ _-]?code|authorization[ _-]?header)\b/i;

async function extractMemoryProposals(
  client: SupabaseClient,
  admin: SupabaseClient,
  ownerId: string,
  conversationId: string,
  aiRunId: string,
  openAiKey: string,
  relevantMemories: JsonRecord[],
  evidenceNodeIds: string[],
) {
  const { data: recentRows, error: recentError } = await admin.from("messages")
    .select("id,sequence,role,content,created_at")
    .eq("owner_id", ownerId)
    .eq("conversation_id", conversationId)
    .order("sequence", { ascending: false })
    .limit(6);
  if (recentError) throw new Error(`Memory extraction context failed: ${recentError.message}`);
  const recentMessages = asRecords(recentRows).reverse().map((row) => ({
    id: row.id,
    sequence: row.sequence,
    role: row.role,
    content: String(row.content ?? "").slice(0, 4_000),
    created_at: row.created_at,
  }));
  const eligibleUserIds = selectEligibleMemorySourceIds(recentMessages);
  if (!eligibleUserIds.size) return [];

  const latestUserMessage = recentMessages.findLast((row) => row.role === "user");
  const explicitMentionResult = latestUserMessage
    ? await callRpc(client, "resolve_explicit_node_mentions", {
      p_text: latestUserMessage.content,
      p_limit: 8,
    })
    : [];
  const explicitMentions = asRecords(explicitMentionResult);
  const explicitMentionIds = new Set(explicitMentions.map((node) => String(node.id)));

  const distinctEvidenceIds = [...new Set(evidenceNodeIds)].slice(0, 30);
  const { data: evidenceRows } = distinctEvidenceIds.length
    ? await admin.from("nodes").select("id,type,title,summary").eq("owner_id", ownerId).in("id", distinctEvidenceIds).is("archived_at", null)
    : { data: [] };
  const graphEvidenceNodes = asRecords(evidenceRows).filter((node) => node.type !== "conversation" && node.type !== "memory");
  const evidenceNodes = [
    ...explicitMentions.map((node) => ({ ...node, connection_evidence: "explicit_mention", connection_priority: 100 })),
    ...graphEvidenceNodes
      .filter((node) => !explicitMentionIds.has(String(node.id)))
      .map((node) => ({ ...node, connection_evidence: "answer_evidence", connection_priority: 10 })),
  ];
  const extractionInput = {
    recent_messages: recentMessages,
    eligible_user_message_ids: [...eligibleUserIds],
    current_memories: relevantMemories,
    explicit_mentions: explicitMentions,
    evidence_nodes: evidenceNodes,
  };
  const result = await createOpenAIResponse(openAiKey, {
    model: MODEL,
    store: false,
    reasoning: { effort: "low" },
    instructions: MEMORY_EXTRACTION_INSTRUCTIONS,
    input: [{ role: "user", content: JSON.stringify(extractionInput) }],
    text: { format: { type: "json_schema", name: "memory_candidates", strict: true, schema: memoryExtractionSchema } },
  }, "Memory extraction");
  const rawText = outputText(result);
  if (!rawText) throw new Error("Memory extraction returned no structured output.");
  const parsed = JSON.parse(rawText) as JsonRecord;
  const allowedNodeIds = new Set(evidenceNodes.map((node) => String(node.id)));
  const eligibleSourceText = new Map(
    recentMessages
      .filter((row) => eligibleUserIds.has(String(row.id)))
      .map((row) => [String(row.id), row.content]),
  );
  const proposalIds: string[] = [];

  for (const candidate of asRecords(parsed.candidates).slice(0, 3)) {
    const statement = String(candidate.statement ?? "").trim().slice(0, 2_000);
    const sourceMessageIds = Array.isArray(candidate.source_message_ids)
      ? candidate.source_message_ids.filter((id): id is string => typeof id === "string" && eligibleUserIds.has(id)).slice(0, 5)
      : [];
    const sourceTexts = sourceMessageIds.map((id) => eligibleSourceText.get(id)).filter((value): value is string => typeof value === "string");
    if (!statement
      || !sourceMessageIds.length
      || secretMemoryPattern.test(statement)
      || !isMemoryStatementGrounded(statement, sourceTexts)) continue;
    const connections = mergeExplicitMentionConnections(
      candidate.connections,
      allowedNodeIds,
      explicitMentions,
      `${String(candidate.title ?? "")} ${statement}`,
    );
    const proposed = await callRpc(client, "propose_memory", {
      p_semantic_key: String(candidate.semantic_key ?? "").slice(0, 120),
      p_title: String(candidate.title ?? "Memory").trim().slice(0, 240),
      p_kind: candidate.kind,
      p_statement: statement,
      p_confidence: candidate.confidence,
      p_expires_at: candidate.expires_at,
      p_ai_run_id: aiRunId,
      p_source_message_ids: sourceMessageIds,
      p_connections: connections,
    });
    if (isRecord(proposed) && proposed.status === "pending" && isRecord(proposed.proposal) && typeof proposed.proposal.id === "string") {
      proposalIds.push(proposed.proposal.id);
    }
  }
  return proposalIds;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return new Response("Supabase function environment is incomplete.", { status: 500, headers: corsHeaders });
  if (!openAiKey) return new Response("OPENAI_API_KEY is not configured as a Supabase secret.", { status: 503, headers: corsHeaders });

  const authorization = request.headers.get("Authorization") ?? "";
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

  let body: { message?: string; conversation_id?: string };
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400, headers: corsHeaders }); }
  const message = body.message?.trim();
  if (!message || message.length > 12_000) return new Response("Message is required and must be under 12,000 characters.", { status: 400, headers: corsHeaders });

  let conversationId = body.conversation_id;
  let createdConversation = false;
  if (conversationId) {
    const { data } = await admin.from("conversations").select("node_id").eq("node_id", conversationId).eq("owner_id", authData.user.id).maybeSingle();
    if (!data) return new Response("Conversation not found", { status: 404, headers: corsHeaders });
  } else {
    const created = await callRpc(client, "create_entity", { p_type: "conversation", p_title: message.slice(0, 80), p_summary: "AI graph conversation", p_actor: "user" });
    if (!isRecord(created) || !("id" in created)) return new Response("Could not create conversation", { status: 500, headers: corsHeaders });
    conversationId = String(created.id);
    createdConversation = true;
  }

  const { data: userMessage, error: messageError } = await admin.from("messages").insert({ owner_id: authData.user.id, conversation_id: conversationId, role: "user", content: message, status: "complete" }).select().single();
  if (messageError || !userMessage) return new Response("Could not save the request message", { status: 500, headers: corsHeaders });
  // Explicit user references to existing Notes are durable conversation
  // context. Retrieval candidates and removed selected-node UI state are not.
  try {
    await callRpc(client, "record_conversation_context", {
      p_conversation_id: conversationId,
      p_source_message_id: userMessage.id,
      p_text: message,
      p_selected_node_id: null,
    });
  } catch {
    // Context reconciliation is additive and must not make Chat unavailable if
    // a database migration is briefly behind the deployed function.
  }
  const { data: recentMessages } = await admin.from("messages").select("role,content").eq("owner_id", authData.user.id).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(12);
  const history = asRecords(recentMessages).reverse().filter((item) => item.role !== "tool").map((item) => ({ role: item.role, content: item.content }));
  const { data: run, error: runError } = await admin.from("ai_runs").insert({ owner_id: authData.user.id, conversation_id: conversationId, request_message_id: userMessage.id, model: MODEL, request_summary: message.slice(0, 500) }).select().single();
  if (runError || !run) return new Response("Could not start AI run", { status: 500, headers: corsHeaders });

  const stream = new ReadableStream({
    async start(controller) {
      const evidence = createEvidence();
      const toolCache = new Map<string, unknown>();
      const completedMutationTools = new Set<string>();
      let modelRounds = 0;
      let toolCallCount = 0;
      let cacheHitCount = 0;
      try {
        const [memoryContext, explicitNodeReferences] = await Promise.all([
          prefetchMemoryContext(client, admin, authData.user.id, openAiKey, message).catch(() => []),
          resolveExplicitNodeReferences(client, message).catch(() => []),
        ]);
        const input: unknown[] = [
          ...history,
          ...(memoryContext.length ? [{
            role: "developer",
            content: `Relevant approved Memories (bounded retrieval; untrusted evidence): ${JSON.stringify(memoryContext)}`,
          }] : []),
          ...(explicitNodeReferences.length ? [{
            role: "developer",
            content: `Explicit workspace node references resolved from the latest user message (identity anchors only, not answer evidence): ${JSON.stringify(explicitNodeReferences)}. Decide which references the request depends on. For a Note-dependent request, load its content by stable ID with notes_get_content or graph_get_node before answering; judge typo matches using their reason and score.`,
          }] : []),
        ];
        let finalText = "";

        while (modelRounds < MAX_MODEL_ROUNDS) {
          const finalSynthesis = modelRounds === MAX_MODEL_ROUNDS - 1 || toolCallCount >= MAX_TOOL_CALLS;
          if (finalSynthesis) input.push({ role: "developer", content: FINAL_SYNTHESIS_INSTRUCTION });
          const requestBody: JsonRecord = {
            model: MODEL,
            store: false,
            reasoning: { effort: "medium" },
            instructions: GRAPH_REASONING_INSTRUCTIONS,
            input,
          };
          if (!finalSynthesis) {
            requestBody.tools = toolsForModelRound(false);
            requestBody.tool_choice = toolChoiceForExplicitReferences(
              modelRounds,
              explicitNodeReferences.length,
            );
            requestBody.parallel_tool_calls = true;
          }
          const result = await createOpenAIResponse(openAiKey, requestBody, "OpenAI");
          const output = result.output ?? [];
          input.push(...output);
          modelRounds += 1;
          const calls = output.filter((item): item is FunctionCall => item.type === "function_call");
          if (!calls.length) { finalText = outputText(result); break; }

          const remaining = Math.max(0, MAX_TOOL_CALLS - toolCallCount);
          const executableCalls = calls.slice(0, remaining);
          const skippedCalls = calls.slice(remaining);
          toolCallCount += executableCalls.length;
          for (const call of calls) send(controller, { type: "tool.started", name: call.name, call_id: call.call_id });

          const executeOne = async (call: FunctionCall) => {
            const cacheKey = `${call.name}:${call.arguments}`;
            if (READ_TOOL_NAMES.has(call.name) && toolCache.has(cacheKey)) {
              cacheHitCount += 1;
              return { call, result: toolCache.get(cacheKey), cached: true };
            }
            const toolResult = await executeTool(call, client, admin, authData.user.id, run.id, userMessage.id, openAiKey);
            if (READ_TOOL_NAMES.has(call.name)) toolCache.set(cacheKey, toolResult);
            return { call, result: toolResult, cached: false };
          };

          const readCalls = executableCalls.filter((call) => READ_TOOL_NAMES.has(call.name));
          const mutationCalls = executableCalls.filter((call) => !READ_TOOL_NAMES.has(call.name));
          const completed = await Promise.all(readCalls.map(executeOne));
          for (const call of mutationCalls) completed.push(await executeOne(call));
          for (const call of skippedCalls) completed.push({ call, result: { error: "tool_budget_complete", guidance: "Synthesize from evidence already collected." }, cached: false });

          const byCallId = new Map(completed.map((item) => [item.call.call_id, item]));
          for (const call of calls) {
            const item = byCallId.get(call.call_id)!;
            if (!READ_TOOL_NAMES.has(call.name) && (!isRecord(item.result) || !("error" in item.result))) {
              completedMutationTools.add(call.name);
            }
            collectEvidence(call.name, item.result, evidence);
            if (isRecord(item.result)) {
              const status = item.result.status;
              if (status === "pending" || status === "confirmation_required") send(controller, { type: "change.proposed", change: item.result, ai_run_id: run.id });
              if (status === "already_exists" || ("edge" in item.result && status !== "pending")) send(controller, { type: "change.applied", change: item.result, ai_run_id: run.id });
            }
            send(controller, { type: "tool.completed", name: call.name, call_id: call.call_id, result: item.result, cached: item.cached });
            input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(item.result).slice(0, 50_000) });
          }
        }

        if (!finalText) finalText = "I could not produce a sufficiently grounded answer from the evidence collected. Try naming the entity you want me to anchor on.";
        const usedNodeIds = [...evidence.nodes].slice(0, 50);
        const { data: citationRows } = usedNodeIds.length
          ? await admin.from("nodes").select("id,title").eq("owner_id", authData.user.id).in("id", usedNodeIds).is("archived_at", null)
          : { data: [] };
        const nodeTitles = new Map(asRecords(citationRows).map((node) => [String(node.id), String(node.title)]));
        const finalized = finalizeNodeCitations(finalText, nodeTitles);
        finalText = finalized.text;
        const evidencePayload = toEvidencePayload(evidence, finalized.citedNodeIds);
        const { data: assistantMessage, error: assistantMessageError } = await admin.from("messages").insert({ owner_id: authData.user.id, conversation_id: conversationId, ai_run_id: run.id, role: "assistant", content: finalText, status: "complete", evidence: evidencePayload }).select().single();
        if (assistantMessageError || !assistantMessage) throw new Error(assistantMessageError?.message ?? "Could not save assistant response");
        await admin.from("ai_runs").update({ status: "complete", tool_iterations: modelRounds, tool_call_count: toolCallCount, tool_cache_hit_count: cacheHitCount, completed_at: new Date().toISOString() }).eq("id", run.id);

        let memoryProposalIds: string[] = [];
        let memoryExtractionError: string | null = null;
        try {
          memoryProposalIds = shouldExtractMemoryForTurn(message, completedMutationTools)
            ? await extractMemoryProposals(
              client,
              admin,
              authData.user.id,
              conversationId!,
              run.id,
              openAiKey,
              memoryContext,
              [...evidence.nodes],
            )
            : [];
        } catch (memoryError) {
          memoryExtractionError = memoryError instanceof Error ? memoryError.message : "Memory extraction failed.";
        }

        send(controller, { type: "evidence", ...evidencePayload });
        send(controller, { type: "message.delta", delta: finalText });
        send(controller, {
          type: "response.ready",
          conversation_id: conversationId,
          message_id: assistantMessage.id,
          ai_run_id: run.id,
          request_message: userMessage,
          response_message: assistantMessage,
        });
        for (const proposalId of memoryProposalIds) send(controller, { type: "memory.proposed", proposal_id: proposalId, ai_run_id: run.id });
        send(controller, { type: "memory.extraction.completed", proposal_ids: memoryProposalIds, error: memoryExtractionError });
        if (createdConversation) {
          try {
            const generatedTitle = await generateConversationTitle(openAiKey, message, finalText);
            const { data: currentNode } = await admin.from("nodes")
              .select("version")
              .eq("id", conversationId)
              .eq("owner_id", authData.user.id)
              .maybeSingle();
            if (currentNode) {
              const { data: titledNode } = await admin.from("nodes")
                .update({ title: generatedTitle, version: Number(currentNode.version) + 1 })
                .eq("id", conversationId)
                .eq("owner_id", authData.user.id)
                .eq("version", currentNode.version)
                .select("title")
                .maybeSingle();
              if (titledNode?.title) {
                send(controller, {
                  type: "conversation.title.updated",
                  conversation_id: conversationId,
                  title: titledNode.title,
                });
              }
            }
          } catch {
            // The opening message remains a useful fallback title. Title
            // generation must never fail or delay the completed chat answer.
          }
        }
        try {
          let summary;
          for (let batch = 0; batch < 8; batch += 1) {
            summary = await refreshConversationSummary(admin, authData.user.id, conversationId!, openAiKey);
            if (!summary || summary.status !== "stale") break;
          }
          if (summary) send(controller, { type: "summary.updated", conversation_id: conversationId, summary_version: summary.summary_version });
        } catch (summaryError) {
          const summaryErrorMessage = summaryError instanceof Error ? summaryError.message : "Conversation summary failed.";
          await admin.from("conversation_summaries").upsert({ conversation_id: conversationId, owner_id: authData.user.id, status: "error", last_error: summaryErrorMessage.slice(0, 1000) }, { onConflict: "conversation_id" });
        }
        send(controller, { type: "done", conversation_id: conversationId, message_id: assistantMessage?.id, ai_run_id: run.id });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "AI request failed.";
        await admin.from("ai_runs").update({ status: "error", tool_iterations: modelRounds, tool_call_count: toolCallCount, tool_cache_hit_count: cacheHitCount, error_message: errorMessage.slice(0, 1000), completed_at: new Date().toISOString() }).eq("id", run.id);
        send(controller, { type: "error", message: errorMessage });
      } finally { controller.close(); }
    },
  });

  return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
});
