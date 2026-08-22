import { cn } from "@/lib/utils";

export type GraphPreviewNode = {
  id: string;
  label: string;
  kind: "note" | "conversation" | "memory";
};

export type GraphPreviewEdge = {
  id: string;
  source: string;
  target: string;
};

const positions = [
  { x: 50, y: 48 },
  { x: 22, y: 27 },
  { x: 79, y: 25 },
  { x: 19, y: 72 },
  { x: 81, y: 72 },
  { x: 48, y: 14 },
  { x: 48, y: 83 },
  { x: 65, y: 53 },
];

const nodeTone = {
  note: "border-sky-300/45 bg-sky-300/15 text-sky-200",
  conversation: "border-pink-300/40 bg-pink-300/15 text-pink-200",
  memory: "border-primary/55 bg-primary/20 text-primary",
};

export function GraphPreview({ nodes, edges, className }: { nodes: GraphPreviewNode[]; edges: GraphPreviewEdge[]; className?: string }) {
  const visibleNodes = nodes.slice(0, positions.length);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const nodePositions = new Map(visibleNodes.map((node, index) => [node.id, positions[index]]));
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));

  return (
    <div className={cn("relative min-h-[300px] overflow-hidden bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_58%)]", className)}>
      <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(circle,color-mix(in_oklch,var(--muted-foreground)_35%,transparent)_1px,transparent_1px)] [background-size:18px_18px]" />
      <svg aria-hidden="true" className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {visibleEdges.map((edge) => {
          const source = nodePositions.get(edge.source);
          const target = nodePositions.get(edge.target);
          if (!source || !target) return null;
          return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} vectorEffect="non-scaling-stroke" className="stroke-primary/30" strokeWidth="1" />;
        })}
      </svg>
      {visibleNodes.map((node, index) => {
        const position = positions[index];
        const featured = index === 0;
        return (
          <div key={node.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${position.x}%`, top: `${position.y}%` }}>
            <div className={cn("relative grid rounded-full border shadow-[0_0_24px_-8px_currentColor]", nodeTone[node.kind], featured ? "size-16" : "size-10")}>
              <span className={cn("m-auto rounded-full bg-current", featured ? "size-3" : "size-2")} />
              <span className="absolute inset-[-7px] rounded-full border border-current/10" />
            </div>
            <p className={cn("absolute left-1/2 mt-2 max-w-28 -translate-x-1/2 truncate whitespace-nowrap rounded-md bg-background/75 px-1.5 py-0.5 text-center text-[10px] text-foreground backdrop-blur", featured && "text-xs font-medium")}>{node.label}</p>
          </div>
        );
      })}
      {!visibleNodes.length ? (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div><p className="text-sm font-medium">Your graph is ready to grow</p><p className="mt-1 text-xs text-muted-foreground">Notes, memories, and conversations will appear here.</p></div>
        </div>
      ) : null}
      <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded-full border border-border/60 bg-background/65 px-3 py-1.5 text-[10px] text-muted-foreground backdrop-blur">
        <span><i className="mr-1 inline-block size-1.5 rounded-full bg-sky-300" />Notes</span>
        <span><i className="mr-1 inline-block size-1.5 rounded-full bg-primary" />Memory</span>
        <span><i className="mr-1 inline-block size-1.5 rounded-full bg-pink-300" />Chats</span>
      </div>
    </div>
  );
}
