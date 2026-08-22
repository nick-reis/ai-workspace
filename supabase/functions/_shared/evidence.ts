import { isSourcePanelSearchCandidate } from "./retrieval-policy.ts";

type JsonRecord = Record<string, unknown>;

export type SearchNodeCandidate = {
  node_id: string;
  retrieval_score?: number;
  retrieval_evidence: string[];
  similarity?: number;
};

export type Evidence = {
  nodes: Set<string>;
  searchedNodes: Map<string, SearchNodeCandidate>;
  edges: Set<string>;
  assertions: Set<string>;
  paths: Array<{ node_ids: string[]; edge_ids: string[] }>;
  content: Array<{ node_id: string; content_version?: number }>;
  messages: Set<string>;
  searchedMessages: Set<string>;
  conversationSummaries: Array<{ conversation_id: string; summary_version?: number }>;
};

export type EvidencePayload = {
  nodes: string[];
  cited_nodes: string[];
  searched_nodes: SearchNodeCandidate[];
  edges: string[];
  assertions: string[];
  paths: Array<{ node_ids: string[]; edge_ids: string[] }>;
  content: Array<{ node_id: string; content_version?: number }>;
  messages: string[];
  searched_messages: string[];
  conversation_summaries: Array<{ conversation_id: string; summary_version?: number }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NODE_CITATION_PATTERN = /\[([^\]\n]{1,240})\]\(workspace-node:([0-9a-f-]{36})\)/gi;
const ANY_NODE_CITATION_PATTERN = /\[([^\]\n]{1,240})\]\(workspace-node:([^)\n]+)\)/gi;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringId(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function addId(target: Set<string>, value: unknown) {
  const id = stringId(value);
  if (id) target.add(id);
  return id;
}

function addNode(evidence: Evidence, value: unknown) {
  addId(evidence.nodes, value);
}

function nestedRecord(value: JsonRecord, key: string) {
  return isRecord(value[key]) ? value[key] : undefined;
}

export function createEvidence(): Evidence {
  return {
    nodes: new Set(),
    searchedNodes: new Map(),
    edges: new Set(),
    assertions: new Set(),
    paths: [],
    content: [],
    messages: new Set(),
    searchedMessages: new Set(),
    conversationSummaries: [],
  };
}

/**
 * Records what a tool did without conflating search candidates with evidence
 * the answer actually selected, loaded, traversed, or changed.
 */
export function collectEvidence(toolName: string, result: unknown, evidence: Evidence) {
  if (toolName === "graph_search_nodes") {
    for (const node of asRecords(result)) {
      const nodeId = stringId(node.id);
      if (!nodeId) continue;
      const score = Number(node.retrieval_score);
      const similarity = Number(node.similarity);
      evidence.searchedNodes.set(nodeId, {
        node_id: nodeId,
        ...(Number.isFinite(score) ? { retrieval_score: score } : {}),
        ...(Number.isFinite(similarity) ? { similarity } : {}),
        retrieval_evidence: Array.isArray(node.retrieval_evidence)
          ? node.retrieval_evidence.filter((item): item is string => typeof item === "string").slice(0, 8)
          : [],
      });
    }
    return;
  }

  if (toolName === "conversations_search_messages") {
    for (const message of asRecords(result)) addId(evidence.searchedMessages, message.id);
    return;
  }

  if (!isRecord(result)) return;
  if (toolName === "graph_get_node" || toolName === "notes_get_content") {
    const node = nestedRecord(result, "node");
    addNode(evidence, node?.id);
    const note = nestedRecord(result, "note");
    if (node?.id && note) evidence.content.push({
      node_id: String(node.id),
      content_version: Number(note.content_version) || undefined,
    });
    return;
  }

  if (toolName === "conversations_get_summary") {
    const node = nestedRecord(result, "node");
    const summary = nestedRecord(result, "summary");
    addNode(evidence, node?.id);
    if (node?.id) evidence.conversationSummaries.push({
      conversation_id: String(node.id),
      summary_version: Number(summary?.summary_version) || undefined,
    });
    return;
  }

  if (toolName === "conversations_get_message_context") {
    addNode(evidence, result.conversation_id);
    for (const message of asRecords(result.messages)) addId(evidence.messages, message.id);
    return;
  }

  if (toolName === "graph_get_neighbors" || toolName === "graph_traverse") {
    for (const node of asRecords(result.nodes)) addNode(evidence, node.id);
    for (const edge of asRecords(result.edges)) addId(evidence.edges, edge.id);
    for (const assertion of asRecords(result.assertions)) addId(evidence.assertions, assertion.id);
    for (const path of asRecords(result.paths)) {
      const nodeIds = Array.isArray(path.node_ids)
        ? path.node_ids.map(stringId).filter((id): id is string => id !== null)
        : [];
      const edgeIds = Array.isArray(path.edge_ids)
        ? path.edge_ids.map(stringId).filter((id): id is string => id !== null)
        : [];
      nodeIds.forEach((id) => evidence.nodes.add(id));
      edgeIds.forEach((id) => evidence.edges.add(id));
      if (nodeIds.length) evidence.paths.push({ node_ids: nodeIds, edge_ids: edgeIds });
    }
    return;
  }

  if (toolName === "graph_propose_relationship") {
    const proposal = nestedRecord(result, "proposal");
    const edge = nestedRecord(result, "edge");
    const assertion = nestedRecord(result, "assertion");
    addNode(evidence, proposal?.source_node_id);
    addNode(evidence, proposal?.target_node_id);
    addId(evidence.edges, proposal?.edge_id ?? edge?.id);
    addId(evidence.assertions, proposal?.assertion_id ?? assertion?.id);
    return;
  }

  if (toolName === "graph_retract_assertion") {
    addId(evidence.assertions, nestedRecord(result, "change")?.assertion_id);
    return;
  }

  if (toolName === "notes_create") {
    addNode(evidence, result.id);
    return;
  }

  if (toolName === "notes_update") {
    addNode(evidence, nestedRecord(result, "change")?.node_id);
  }
}

function escapeMarkdownLabel(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function nodeLink(nodeId: string, title: string) {
  return `[${escapeMarkdownLabel(title)}](workspace-node:${nodeId})`;
}

export function finalizeNodeCitations(
  text: string,
  nodeTitles: ReadonlyMap<string, string>,
) {
  const canonicalTitles = new Map(
    [...nodeTitles].map(([id, title]) => [id.toLowerCase(), title] as const),
  );
  const citedNodeIds: string[] = [];
  const cited = new Set<string>();

  let content = text.replace(NODE_CITATION_PATTERN, (_original, label: string, rawNodeId: string) => {
    const nodeId = rawNodeId.toLowerCase();
    const title = canonicalTitles.get(nodeId);
    if (!UUID_PATTERN.test(nodeId) || !title) return label;
    if (cited.has(nodeId)) return title;
    cited.add(nodeId);
    citedNodeIds.push(nodeId);
    return nodeLink(nodeId, title);
  });

  content = content.replace(ANY_NODE_CITATION_PATTERN, (original, label: string, rawNodeId: string) => {
    const nodeId = rawNodeId.toLowerCase();
    return UUID_PATTERN.test(nodeId) && canonicalTitles.has(nodeId) ? original : label;
  });
  return { text: content, citedNodeIds };
}

export function toEvidencePayload(evidence: Evidence, citedNodeIds: readonly string[]): EvidencePayload {
  return {
    nodes: [...evidence.nodes].slice(0, 50),
    cited_nodes: [...new Set(citedNodeIds)].filter((id) => evidence.nodes.has(id)).slice(0, 20),
    searched_nodes: [...evidence.searchedNodes.values()]
      .filter(isSourcePanelSearchCandidate)
      .slice(0, 50)
      .map(({ node_id, retrieval_score, retrieval_evidence }) => ({
        node_id,
        ...(retrieval_score === undefined ? {} : { retrieval_score }),
        retrieval_evidence,
      })),
    edges: [...evidence.edges].slice(0, 100),
    assertions: [...evidence.assertions].slice(0, 100),
    paths: evidence.paths.slice(0, 30),
    content: evidence.content.slice(0, 30),
    messages: [...evidence.messages].slice(0, 50),
    searched_messages: [...evidence.searchedMessages].slice(0, 50),
    conversation_summaries: evidence.conversationSummaries.slice(0, 20),
  };
}
