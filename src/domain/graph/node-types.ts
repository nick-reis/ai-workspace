import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
import NoteIcon from "@hugeicons/core-free-icons/NoteIcon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import type { IconSvgElement } from "@hugeicons/react";
import { z } from "zod";

export const nodeTypes = ["conversation", "memory", "note"] as const;
export type NodeType = (typeof nodeTypes)[number];
export const nodeTypeSchema = z.enum(nodeTypes);

export type NodeTypeDefinition = {
  value: NodeType;
  label: string;
  pluralLabel: string;
  icon: IconSvgElement;
  tone: "amber" | "blue" | "rose";
  graphColor: string;
  labelPriority: number;
};

export const nodeTypeDefinitions = {
  conversation: {
    value: "conversation",
    label: "Conversation",
    pluralLabel: "Conversations",
    icon: BubbleChatIcon,
    tone: "amber",
    graphColor: "#f472b6",
    labelPriority: 10,
  },
  memory: {
    value: "memory",
    label: "Memory",
    pluralLabel: "Memories",
    icon: SparklesIcon,
    tone: "rose",
    graphColor: "#c084fc",
    labelPriority: 90,
  },
  note: {
    value: "note",
    label: "Note",
    pluralLabel: "Notes",
    icon: NoteIcon,
    tone: "blue",
    graphColor: "#60a5fa",
    labelPriority: 100,
  },
} satisfies Record<NodeType, NodeTypeDefinition>;

export function getNodeTypeDefinition(type: NodeType): NodeTypeDefinition {
  return nodeTypeDefinitions[type];
}
