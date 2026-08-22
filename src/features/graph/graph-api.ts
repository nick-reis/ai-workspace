import { supabase } from "@/lib/supabase";
import { collectPaginatedRows } from "@/lib/supabase-result";
import { neighborhoodSchema } from "@/types/graph";
import type { Database } from "@/types/database.generated";

type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
type EdgeRow = Database["public"]["Tables"]["edges"]["Row"];
type AssertionRow = Database["public"]["Tables"]["edge_assertions"]["Row"];

export async function getWorkspaceGraph() {
  const [nodes, edges, assertions] = await Promise.all([
    collectPaginatedRows<NodeRow>(async (from, to) => {
      const result = await supabase.from("nodes").select("*").is("archived_at", null).order("title").order("id").range(from, to);
      return { data: result.data, error: result.error };
    }),
    collectPaginatedRows<EdgeRow>(async (from, to) => {
      const result = await supabase.from("edges").select("*").is("archived_at", null).order("created_at").order("id").range(from, to);
      return { data: result.data, error: result.error };
    }),
    collectPaginatedRows<AssertionRow>(async (from, to) => {
      const result = await supabase.from("edge_assertions").select("*")
        .eq("status", "active").is("retracted_at", null)
        .order("created_at").order("id").range(from, to);
      return { data: result.data, error: result.error };
    }),
  ]);
  const liveEdgeIds = new Set(edges.map((edge) => edge.id));
  return neighborhoodSchema.parse({
    nodes,
    edges,
    assertions: assertions.filter((assertion) => liveEdgeIds.has(assertion.edge_id)),
  });
}
