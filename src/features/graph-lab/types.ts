export type GraphNode = {
  id: string;
  label: string;
  labelPriority?: number;
  color?: string;
  radius?: number;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relationshipType?: string;
  color?: string;
};

/**
 * The graph renderer's complete data contract. It deliberately contains no
 * database fields, query clients, or API concerns.
 */
export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type Camera = {
  x: number;
  y: number;
  scale: number;
};

export type GraphRenderer = {
  readonly kind: "WebGL 2" | "Canvas 2D";
  resize(width: number, height: number, pixelRatio: number): void;
  render(positions: Float32Array, camera: Camera): void;
  destroy(): void;
};
