import { nodeTypeDefinitions } from "@/domain/graph/node-types";
import { relationshipContracts } from "@/domain/graph/relationships";
import type { GraphData } from "@/features/graph-lab";
import type { Neighborhood } from "@/types/graph";

/** Backend-aware mapping kept outside the backend-free renderer feature. */
export function toGraphData(neighborhood: Neighborhood): GraphData {
  const nodeIds = new Set(neighborhood.nodes.map((node) => node.id));
  const visibleEdges = neighborhood.edges.filter((edge) =>
    nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id),
  );
  const degree = new Map<string, number>();
  for (const edge of visibleEdges) {
    degree.set(edge.source_node_id, (degree.get(edge.source_node_id) ?? 0) + 1);
    degree.set(edge.target_node_id, (degree.get(edge.target_node_id) ?? 0) + 1);
  }

  return {
    nodes: neighborhood.nodes.map((node) => {
      const definition = nodeTypeDefinitions[node.type];
      return {
        id: node.id,
        label: node.title,
        labelPriority: definition.labelPriority + Math.min(50, (degree.get(node.id) ?? 0) * 8),
        color: definition.graphColor,
        radius: Math.min(13, 5.5 + Math.sqrt(degree.get(node.id) ?? 0) * 1.7),
      };
    }),
    edges: visibleEdges.map((edge) => ({
      id: edge.id,
      source: edge.source_node_id,
      target: edge.target_node_id,
      relationshipType: edge.relationship_type,
      color: relationshipContracts[edge.relationship_type].color,
    })),
  };
}
