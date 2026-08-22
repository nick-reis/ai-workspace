import { describe, expect, it } from "vitest";

import type { MessageEvidenceBundle } from "@/types/graph";
import { dedupeConversationSummaries } from "./source-presentation";

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;

describe("source presentation", () => {
  it("hides a conversation summary when the same conversation is already a source node", () => {
    const nodes = [{ id: id(1), type: "conversation" }] as MessageEvidenceBundle["nodes"];
    const summaries = [
      { conversation_id: id(1), title: "Same conversation" },
      { conversation_id: id(2), title: "Summary-only conversation" },
    ] as MessageEvidenceBundle["conversation_summaries"];
    expect(dedupeConversationSummaries(nodes, summaries).map((summary) => summary.conversation_id)).toEqual([id(2)]);
  });
});
