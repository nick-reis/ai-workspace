import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";

import type { IconData } from "@/components/ui/icon";
import { nodeTypeDefinitions, nodeTypes, type NodeType } from "@/domain/graph/node-types";

export type WorkspaceSearchFilter = "all" | NodeType;

export const workspaceSearchFilters = [
  { value: "all", label: "All nodes", icon: Search01Icon },
  ...nodeTypes.map((type) => ({
    value: type,
    label: nodeTypeDefinitions[type].pluralLabel,
    icon: nodeTypeDefinitions[type].icon,
  })),
] satisfies ReadonlyArray<{
  value: WorkspaceSearchFilter;
  label: string;
  icon: IconData;
}>;

export function getWorkspaceSearchFilter(value: WorkspaceSearchFilter) {
  return workspaceSearchFilters.find((option) => option.value === value) ?? workspaceSearchFilters[0];
}
