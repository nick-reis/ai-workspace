import { supabase } from "@/lib/supabase";
import { unwrapSupabaseResult } from "@/lib/supabase-result";
import type { Database } from "@/types/database.generated";
import type { NodeType } from "@/types/graph";

export type WorkspaceSearchNode = Database["public"]["Tables"]["nodes"]["Row"];

export async function searchWorkspaceNodes(
  query: string,
  type: NodeType | null,
): Promise<WorkspaceSearchNode[]> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const result = await supabase.rpc("search_nodes", {
    p_query: query.trim(),
    p_types: type ? [type] : null,
    p_limit: 50,
  });

  const nodes = unwrapSupabaseResult(result, "Could not search the workspace.");
  if (!normalizedQuery) return nodes.slice(0, 25);

  const matchTier = (title: string) => {
    const normalizedTitle = title.toLocaleLowerCase();
    if (normalizedTitle === normalizedQuery) return 0;
    if (normalizedTitle.startsWith(normalizedQuery)) return 1;
    return 2;
  };

  return nodes
    .filter((node) => node.title.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) =>
      matchTier(left.title) - matchTier(right.title)
      || Date.parse(right.updated_at) - Date.parse(left.updated_at))
    .slice(0, 25);
}
