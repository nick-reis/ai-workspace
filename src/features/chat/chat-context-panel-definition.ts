import type { ContextPanelDefinition } from "@/components/workspace/contextual-workspace";

export type ChatPanelView =
  | { mode: "review"; aiRunId: string }
  | { mode: "sources"; messageId: string; focusNodeId?: string }
  | null;

export function getChatContextPanelMetadata(
  view: Exclude<ChatPanelView, null>,
): Omit<ContextPanelDefinition, "content"> {
  if (view.mode === "review") {
    return {
      key: `review:${view.aiRunId}`,
      title: "Review changes",
      description: "Approve or reject each proposed workspace change.",
      ariaLabel: "Review changes",
    };
  }

  return {
    key: `sources:${view.messageId}:${view.focusNodeId ?? ""}`,
    title: "Sources",
    description: "Cited evidence and inspected search candidates.",
    ariaLabel: "Sources",
  };
}
