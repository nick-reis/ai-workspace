import { useQuery } from "@tanstack/react-query";
import Activity01Icon from "@hugeicons/core-free-icons/Activity01Icon";
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import HierarchyIcon from "@hugeicons/core-free-icons/HierarchyIcon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  CollectionRow,
  CollectionSection,
  DetailSection,
  PropertyRow,
  SegmentedControl,
  SoftBadge,
  WorkspaceEmptyState,
  WorkspaceFrame,
  WorkspacePaneHeader,
  type SegmentOption,
} from "@/components/workspace/workspace-view";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { nodeTypeDefinitions, nodeTypes, type NodeType } from "@/domain/graph/node-types";
import { activityKeys, listActivityPage } from "@/features/activity/activity-api";
import { getWorkspaceGraph } from "@/features/graph/graph-api";
import { graphKeys } from "@/features/graph/query-keys";
import { formatDate, relativeTime } from "@/lib/date-format";
import type { ActivityItem, NodeSummary } from "@/types/graph";

type WorkspaceFilter = "all" | NodeType;

const filterOptions: SegmentOption<WorkspaceFilter>[] = [
  { value: "all", label: "All" },
  ...nodeTypes.map((type) => ({
    value: type,
    label: nodeTypeDefinitions[type].pluralLabel,
  })),
];

function activityTitle(item: ActivityItem) {
  if (item.kind === "memory_proposal") return item.title;
  if (item.kind === "relationship_proposal") return `${item.source_title} → ${item.target_title}`;
  return item.operation.replaceAll("_", " ");
}

function activityDescription(item: ActivityItem) {
  if (item.kind === "memory_proposal") return item.statement;
  if (item.kind === "relationship_proposal") return item.relationship_type.replaceAll("_", " ");
  return item.reason ?? "Suggested graph change";
}

function activityConversation(item: ActivityItem) {
  return item.kind === "graph_change" ? null : item.conversation_id;
}

export function HomePage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<WorkspaceFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const graphQuery = useQuery({ queryKey: graphKeys.workspace, queryFn: getWorkspaceGraph });
  const activityQuery = useQuery({ queryKey: activityKeys.pendingPage, queryFn: () => listActivityPage({ limit: 50, state: "pending" }) });

  const graph = graphQuery.data;
  const nodes = useMemo(() => graph?.nodes ?? [], [graph?.nodes]);
  const edges = useMemo(() => graph?.edges ?? [], [graph?.edges]);
  const pending = useMemo(() => activityQuery.data?.items ?? [], [activityQuery.data?.items]);
  const filteredNodes = useMemo(
    () => [...nodes]
      .filter((node) => filter === "all" || node.type === filter)
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
    [filter, nodes],
  );

  const effectiveSelectedId = filteredNodes.some((node) => node.id === selectedId)
    ? selectedId
    : filteredNodes[0]?.id ?? null;
  const selectedNode = nodes.find((node) => node.id === effectiveSelectedId) ?? null;
  const selectedEdges = selectedNode
    ? edges.filter((edge) => edge.source_node_id === selectedNode.id || edge.target_node_id === selectedNode.id)
    : [];
  const connectedNodes = selectedEdges.map((edge) => {
    const connectedId = edge.source_node_id === selectedNode?.id ? edge.target_node_id : edge.source_node_id;
    return { edge, node: nodes.find((candidate) => candidate.id === connectedId) };
  }).filter((entry): entry is { edge: (typeof edges)[number]; node: NodeSummary } => Boolean(entry.node));
  const selectedAssertionCount = graph?.assertions.filter((assertion) => selectedEdges.some((edge) => edge.id === assertion.edge_id) && assertion.status === "active").length ?? 0;
  const graphError = graphQuery.error instanceof Error;
  const activityError = activityQuery.error instanceof Error;

  const openNewChat = () => navigate("/chat", { state: { newChatRequest: crypto.randomUUID() } });

  return (
    <main className="mx-auto w-full max-w-[1480px] p-3 sm:p-5 lg:p-6">
      <WorkspaceFrame
        collection={
          <div className="flex h-full min-h-0 flex-col">
            <WorkspacePaneHeader
              title="My workspace"
              description="Notes, memories, and conversations"
              actions={<Button size="sm" onClick={openNewChat}><Icon icon={Add01Icon} data-icon="inline-start" />New</Button>}
            />
            <div className="border-b border-border bg-card px-5 py-4 sm:px-6">
              <SegmentedControl value={filter} options={filterOptions} onChange={setFilter} />
            </div>
            <div className="scroll-fade min-h-0 flex-1 space-y-7 overflow-y-auto p-4 sm:p-5">
              {graphError ? (
                <WorkspaceEmptyState icon={AlertCircleIcon} title="Workspace unavailable" description="Sign in or restore workspace access to load your items." />
              ) : graphQuery.isLoading ? (
                <div className="space-y-3"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div>
              ) : filteredNodes.length ? (
                <CollectionSection title="Recently updated" count={filteredNodes.length}>
                  {filteredNodes.map((node) => {
                    const presentation = nodeTypeDefinitions[node.type];
                    const connectionCount = edges.filter((edge) => edge.source_node_id === node.id || edge.target_node_id === node.id).length;
                    return (
                      <CollectionRow
                        key={node.id}
                        icon={presentation.icon}
                        title={node.title}
                        summary={node.summary ?? "No summary yet"}
                        metadata={<><span className="flex items-center gap-1"><Icon icon={Clock01Icon} className="size-3" />{relativeTime(node.updated_at)}</span><span className="flex items-center gap-1"><Icon icon={Link01Icon} className="size-3" />{connectionCount}</span></>}
                        badge={<SoftBadge tone={presentation.tone}>{presentation.label}</SoftBadge>}
                        selected={selectedId === node.id}
                        onClick={() => setSelectedId(node.id)}
                      />
                    );
                  })}
                </CollectionSection>
              ) : (
                <WorkspaceEmptyState icon={File01Icon} title={filter === "all" ? "Your workspace is ready" : `No ${filter === "memory" ? "memories" : `${filter}s`} yet`} description="Start a conversation to capture ideas and build your connected workspace." action={<Button size="sm" onClick={openNewChat}>Start a conversation</Button>} />
              )}

              {!activityError && pending.length ? (
                <CollectionSection title="Needs review" count={pending.length}>
                  {pending.slice(0, 4).map((item) => {
                    const conversationId = activityConversation(item);
                    return (
                      <CollectionRow
                        key={`${item.kind}:${item.id}`}
                        icon={Activity01Icon}
                        title={activityTitle(item)}
                        summary={activityDescription(item)}
                        metadata={<span className="flex items-center gap-1"><Icon icon={Clock01Icon} className="size-3" />{relativeTime(item.created_at)}</span>}
                        badge={<SoftBadge tone="rose">Review</SoftBadge>}
                        onClick={() => conversationId ? navigate(`/chat?conversation=${encodeURIComponent(conversationId)}`) : navigate("/chat")}
                      />
                    );
                  })}
                </CollectionSection>
              ) : null}
            </div>
          </div>
        }
        detail={
          <div className="flex h-full min-h-0 flex-col">
            <WorkspacePaneHeader
              title={selectedNode ? "Item details" : "Welcome"}
              actions={selectedNode ? <Button variant="ghost" size="sm" onClick={() => navigate("/graph")}>Open graph <Icon icon={ArrowUpRight01Icon} data-icon="inline-end" /></Button> : null}
            />
            <div className="scroll-fade min-h-0 flex-1 overflow-y-auto">
              {selectedNode ? (
                <div className="space-y-7 p-6 sm:p-8">
                  <div>
                    <div className="flex items-center gap-2">
                      <SoftBadge tone={nodeTypeDefinitions[selectedNode.type].tone}>{nodeTypeDefinitions[selectedNode.type].label}</SoftBadge>
                      <span className="text-xs text-muted-foreground">Updated {relativeTime(selectedNode.updated_at)}</span>
                    </div>
                    <h2 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight tracking-[-0.045em] text-foreground">{selectedNode.title}</h2>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-xl bg-linear-to-r from-sky-50 via-rose-50 to-amber-50 px-4 py-3.5 dark:from-sky-400/10 dark:via-rose-400/10 dark:to-amber-400/10">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground"><span className="grid size-8 place-items-center rounded-lg bg-foreground text-background"><Icon icon={HierarchyIcon} className="size-4" /></span>Connected workspace item</span>
                    <span className="text-sm font-semibold text-foreground">{selectedEdges.length} connection{selectedEdges.length === 1 ? "" : "s"}</span>
                  </div>

                  <DetailSection title="Summary">
                    <p className="max-w-2xl whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{selectedNode.summary ?? "This item does not have a summary yet."}</p>
                  </DetailSection>

                  <DetailSection title="Details">
                    <div className="divide-y divide-border">
                      <PropertyRow icon={File01Icon} label="Type" value={nodeTypeDefinitions[selectedNode.type].label} />
                      <PropertyRow icon={Clock01Icon} label="Created" value={formatDate(selectedNode.created_at, true)} />
                      <PropertyRow icon={Clock01Icon} label="Updated" value={formatDate(selectedNode.updated_at, true)} />
                      <PropertyRow icon={Link01Icon} label="Provenance" value={`${selectedAssertionCount} active record${selectedAssertionCount === 1 ? "" : "s"}`} />
                    </div>
                  </DetailSection>

                  <DetailSection title="Connections" action={<Button variant="ghost" size="xs" onClick={() => navigate("/graph")}>View all</Button>}>
                    {connectedNodes.length ? (
                      <div className="space-y-2">
                        {connectedNodes.slice(0, 5).map(({ edge, node }) => (
                          <button key={edge.id} type="button" onClick={() => setSelectedId(node.id)} className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25">
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon icon={nodeTypeDefinitions[node.type].icon} className="size-4" /></span>
                            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{node.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{edge.relationship_type.replaceAll("_", " ")}</span></span>
                            <SoftBadge tone={nodeTypeDefinitions[node.type].tone}>{nodeTypeDefinitions[node.type].label}</SoftBadge>
                          </button>
                        ))}
                      </div>
                    ) : <p className="text-sm text-muted-foreground">No connections yet. They will appear here as your workspace grows.</p>}
                  </DetailSection>

                  <div className="flex flex-wrap gap-2 border-t border-border pt-6">
                    {selectedNode.type === "conversation" ? <Button onClick={() => navigate(`/chat?conversation=${encodeURIComponent(selectedNode.id)}`)}>Open conversation</Button> : <Button onClick={openNewChat}>Ask workspace</Button>}
                    <Button variant="outline" onClick={() => navigate("/graph")}><Icon icon={HierarchyIcon} data-icon="inline-start" />Explore relationships</Button>
                  </div>
                </div>
              ) : graphQuery.isLoading ? (
                <div className="space-y-4 p-8"><Skeleton className="h-6 w-24" /><Skeleton className="h-10 w-3/4" /><Skeleton className="h-28 w-full" /></div>
              ) : (
                <WorkspaceEmptyState icon={SparklesIcon} title="A calm place for your thinking" description="Your notes, conversations, and confirmed memories will stay connected without getting in the way." action={<Button onClick={openNewChat}>Start a conversation</Button>} />
              )}
            </div>
          </div>
        }
      />
    </main>
  );
}
