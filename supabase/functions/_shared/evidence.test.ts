import { describe, expect, it } from "vitest";

import {
  collectEvidence,
  createEvidence,
  finalizeNodeCitations,
  toEvidencePayload,
} from "./evidence.ts";

const ids = {
  cooking: "11111111-1111-4111-8111-111111111111",
  bgp: "22222222-2222-4222-8222-222222222222",
  change: "33333333-3333-4333-8333-333333333333",
};

describe("evidence provenance", () => {
  it("keeps search candidates separate until a node is selected or changed", () => {
    const evidence = createEvidence();
    collectEvidence("graph_search_nodes", [
      { id: ids.cooking, retrieval_score: 12, retrieval_evidence: ["exact_title"] },
      { id: ids.bgp, retrieval_score: 0.2, similarity: 0.2, retrieval_evidence: ["semantic_similarity"] },
    ], evidence);

    expect([...evidence.nodes]).toEqual([]);
    expect([...evidence.searchedNodes]).toHaveLength(2);

    collectEvidence("notes_update", {
      status: "confirmation_required",
      change: { id: ids.change, node_id: ids.cooking },
    }, evidence);

    expect([...evidence.nodes]).toEqual([ids.cooking]);
    expect(toEvidencePayload(evidence, [ids.cooking])).toMatchObject({
      nodes: [ids.cooking],
      cited_nodes: [ids.cooking],
      searched_nodes: [
        { node_id: ids.cooking },
      ],
    });
  });

  it("keeps weak ranked candidates available during reasoning but omits them from Sources", () => {
    const evidence = createEvidence();
    collectEvidence("graph_search_nodes", [
      { id: ids.bgp, retrieval_score: 0.2, similarity: 0.2, retrieval_evidence: ["semantic_similarity"] },
    ], evidence);

    expect([...evidence.searchedNodes]).toHaveLength(1);
    expect(toEvidencePayload(evidence, []).searched_nodes).toEqual([]);
  });

  it("treats message search hits as candidates and context-window messages as used", () => {
    const evidence = createEvidence();
    collectEvidence("conversations_search_messages", [{ id: ids.bgp }], evidence);
    expect([...evidence.messages]).toEqual([]);
    expect([...evidence.searchedMessages]).toEqual([ids.bgp]);

    collectEvidence("conversations_get_message_context", {
      conversation_id: ids.cooking,
      messages: [{ id: ids.bgp }],
    }, evidence);
    expect([...evidence.messages]).toEqual([ids.bgp]);
    expect([...evidence.nodes]).toEqual([ids.cooking]);
  });
});

describe("inline node citations", () => {
  const titles = new Map([[ids.cooking, "Cooking Ideas"]]);

  it("canonicalizes valid used-node citations and removes an invalid destination", () => {
    const result = finalizeNodeCitations(
      `Updated [wrong title](workspace-node:${ids.cooking}); ignored [BGP](workspace-node:${ids.bgp}).`,
      titles,
    );
    expect(result.text).toBe(`Updated [Cooking Ideas](workspace-node:${ids.cooking}); ignored BGP.`);
    expect(result.citedNodeIds).toEqual([ids.cooking]);
  });

  it("keeps only the first citation pill for a node", () => {
    const result = finalizeNodeCitations(
      `The [Cooking Ideas](workspace-node:${ids.cooking}) note is short. It remains [Cooking Ideas](workspace-node:${ids.cooking}).`,
      titles,
    );
    expect(result.text).toBe(`The [Cooking Ideas](workspace-node:${ids.cooking}) note is short. It remains Cooking Ideas.`);
    expect(result.citedNodeIds).toEqual([ids.cooking]);
  });

  it("does not append citations for evidence the answer leaves unnamed", () => {
    const result = finalizeNodeCitations("I proposed the requested update.", titles);
    expect(result.text).toBe("I proposed the requested update.");
    expect(result.citedNodeIds).toEqual([]);
  });
});
