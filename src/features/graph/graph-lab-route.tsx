import { useQuery } from "@tanstack/react-query";

import { GraphLabPage } from "@/features/graph-lab";

import { toGraphData } from "./graph-adapter";
import { getWorkspaceGraph } from "./graph-api";
import { graphKeys } from "./query-keys";

export function GraphLabRoute() {
  const graphQuery = useQuery({
    queryKey: graphKeys.workspace,
    queryFn: getWorkspaceGraph,
  });
  const graph = graphQuery.data ? toGraphData(graphQuery.data) : undefined;
  const error = graphQuery.error instanceof Error ? graphQuery.error.message : graphQuery.error ? "Unable to load the graph." : undefined;

  return <GraphLabPage data={graph} isLoading={graphQuery.isLoading} error={error} />;
}
