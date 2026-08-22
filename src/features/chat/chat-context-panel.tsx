import { useQuery } from "@tanstack/react-query";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import BookOpen01Icon from "@hugeicons/core-free-icons/BookOpen01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import Route01Icon from "@hugeicons/core-free-icons/Route01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { useEffect, useMemo, useRef, useState } from "react";

import { Icon, type IconData } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { StaggerChildren } from "@/components/ui/stagger-children";
import { useContextPanelClose } from "@/components/workspace/contextual-workspace-context";
import { SoftBadge } from "@/components/workspace/workspace-view";
import { activityKeys, getMessageEvidence, listRunActivity } from "@/features/activity/activity-api";
import { ActivityCard } from "@/features/activity/activity-card";
import { useActivityAction } from "@/features/activity/use-activity-action";
import { cn } from "@/lib/utils";
import { dedupeConversationSummaries } from "./source-presentation";

import type { ChatPanelView } from "./chat-context-panel-definition";

function ReviewPanel({ aiRunId }: { aiRunId: string }) {
  const [error, setError] = useState<string | null>(null);
  const closePanel = useContextPanelClose();
  const review = useQuery({ queryKey: activityKeys.run(aiRunId), queryFn: () => listRunActivity(aiRunId) });
  const action = useActivityAction(setError);
  const pending = review.data?.filter((item) => item.available_actions.some((available) => available === "approve" || available === "reject")) ?? [];
  const hadPendingRef = useRef(false);
  const closedRef = useRef(false);

  useEffect(() => {
    hadPendingRef.current = false;
    closedRef.current = false;
  }, [aiRunId]);

  useEffect(() => {
    if (review.isLoading || review.isFetching || action.isPending || !review.data?.length) return;
    if (pending.length) {
      hadPendingRef.current = true;
      return;
    }
    if (hadPendingRef.current && !closedRef.current) {
      closedRef.current = true;
      closePanel();
    }
  }, [action.isPending, closePanel, pending.length, review.data?.length, review.isFetching, review.isLoading]);

  if (review.isLoading) return <div className="space-y-3"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div>;
  if (review.error) return <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{review.error instanceof Error ? review.error.message : "Review could not be loaded."}</p>;
  if (!review.data?.length) return <div className="grid min-h-48 place-items-center text-center"><div><Icon icon={AlertCircleIcon} className="mx-auto size-5 text-muted-foreground" /><p className="mt-2 text-sm font-medium">Preparing review…</p><p className="mt-1 text-xs text-muted-foreground">The proposal will appear here when it is ready.</p></div></div>;

  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {pending.length > 1 ? <p className="text-xs text-muted-foreground">{pending.length} proposals need individual review.</p> : null}
      <StaggerChildren className="space-y-3">
        {review.data.map((item) => <ActivityCard key={`${item.kind}:${item.id}`} item={item} busyAction={action.isPending && action.variables?.item.id === item.id ? action.variables.action : null} onAction={(target, nextAction) => { setError(null); action.mutate({ item: target, action: nextAction }); }} />)}
      </StaggerChildren>
    </div>
  );
}

function SourceRow({ icon, title, detail, badge, nodeId, focused = false }: { icon: IconData; title: string; detail: string; badge?: string; nodeId?: string; focused?: boolean }) {
  return (
    <article data-source-node-id={nodeId} className={cn("flex w-full items-start gap-3 rounded-xl border border-border/70 px-3 py-3 text-left transition-colors", focused && "border-foreground/30 bg-muted/65 ring-1 ring-foreground/10")}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card text-muted-foreground"><Icon icon={icon} className="size-4" /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{title}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span></span>
      {badge ? <SoftBadge tone="amber">{badge}</SoftBadge> : null}
    </article>
  );
}

function EvidenceSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/80">{title}</h3>
      {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      <StaggerChildren className="mt-2 space-y-2">{children}</StaggerChildren>
    </section>
  );
}

function searchCandidateDetail(candidate: { retrieval_score: number | null; retrieval_evidence: string[] }) {
  const reason = candidate.retrieval_evidence.includes("exact_title")
    ? "Exact title match"
    : candidate.retrieval_evidence.includes("title")
      ? "Title match"
      : candidate.retrieval_evidence.includes("alias")
        ? "Alias match"
        : candidate.retrieval_evidence.includes("semantic_similarity")
          ? "Semantic candidate"
          : "Search candidate";
  return candidate.retrieval_score === null ? reason : `${reason} · score ${candidate.retrieval_score.toFixed(2)}`;
}

function SourcesPanel({ messageId, focusNodeId }: { messageId: string; focusNodeId?: string }) {
  const sources = useQuery({ queryKey: activityKeys.evidence(messageId), queryFn: () => getMessageEvidence(messageId) });
  const evidence = sources.data;
  const visibleSummaries = useMemo(() => evidence ? dedupeConversationSummaries(evidence.nodes, evidence.conversation_summaries) : [], [evidence]);

  useEffect(() => {
    if (!focusNodeId || !evidence) return;
    const target = document.querySelector<HTMLElement>(`[data-source-node-id="${focusNodeId}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [evidence, focusNodeId]);

  if (sources.isLoading) return <div className="space-y-3"><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>;
  if (sources.error) return <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{sources.error instanceof Error ? sources.error.message : "Sources could not be loaded."}</p>;
  if (!evidence || (!evidence.nodes.length && !evidence.searched_nodes.length && !evidence.edges.length && !evidence.messages.length && !evidence.searched_messages.length && !visibleSummaries.length && !evidence.paths.length)) return <div className="grid min-h-48 place-items-center text-center"><div><Icon icon={BookOpen01Icon} className="mx-auto size-5 text-muted-foreground" /><p className="mt-2 text-sm font-medium">No sources recorded</p><p className="mt-1 text-xs text-muted-foreground">This response did not use or search workspace evidence.</p></div></div>;

  const citedIds = new Set(evidence.cited_nodes);
  const usedNodeIds = new Set(evidence.nodes.map((node) => node.id));
  const usedMessageIds = new Set(evidence.messages.map((message) => message.id));
  const citedNodes = evidence.nodes.filter((node) => citedIds.has(node.id));
  const otherUsedNodes = evidence.nodes.filter((node) => !citedIds.has(node.id));
  const searchedNodes = evidence.searched_nodes.filter((node) => !usedNodeIds.has(node.id));
  const searchedMessages = evidence.searched_messages.filter((message) => !usedMessageIds.has(message.id));
  const missingCount = Object.values(evidence.missing).reduce((sum, ids) => sum + ids.length, 0);

  return (
    <div className="space-y-5">
      {(citedNodes.length || otherUsedNodes.length || evidence.edges.length || evidence.messages.length || visibleSummaries.length || evidence.paths.length) ? (
        <StaggerChildren className="space-y-2">
          {citedNodes.map((node) => <SourceRow key={`cited:${node.id}`} nodeId={node.id} focused={focusNodeId === node.id} icon={File01Icon} title={node.title} detail={node.summary ?? node.type} badge={node.changed_since_answer ? "Changed" : undefined} />)}
          {otherUsedNodes.map((node) => <SourceRow key={`node:${node.id}`} nodeId={node.id} focused={focusNodeId === node.id} icon={File01Icon} title={node.title} detail={node.summary ?? node.type} badge={node.changed_since_answer ? "Changed" : undefined} />)}
          {evidence.edges.map((edge) => <SourceRow key={`edge:${edge.id}`} icon={Link01Icon} title={`${edge.source.title} → ${edge.target.title}`} detail={edge.relationship_type.replaceAll("_", " ")} />)}
          {evidence.messages.map((message) => <SourceRow key={`message:${message.id}`} icon={Message01Icon} title={message.conversation_title} detail={message.content} />)}
          {visibleSummaries.map((summary) => <SourceRow key={`summary:${summary.conversation_id}`} nodeId={summary.conversation_id} focused={focusNodeId === summary.conversation_id} icon={Message01Icon} title={summary.title} detail="Conversation summary" badge={summary.changed_since_answer ? "Changed" : undefined} />)}
          {evidence.paths.map((path, index) => <SourceRow key={`path:${index}`} icon={Route01Icon} title={`Path ${index + 1}`} detail={`${path.node_ids.length} items · ${path.edge_ids.length} relationships`} />)}
        </StaggerChildren>
      ) : null}
      {(searchedNodes.length || searchedMessages.length) ? (
        <EvidenceSection title="Searched candidates">
          {searchedNodes.map((node) => <SourceRow key={`searched-node:${node.id}`} icon={Search01Icon} title={node.title} detail={searchCandidateDetail(node)} />)}
          {searchedMessages.map((message) => <SourceRow key={`searched-message:${message.id}`} icon={Search01Icon} title={message.conversation_title} detail={message.content} />)}
        </EvidenceSection>
      ) : null}
      {missingCount ? <p className="rounded-xl border border-border bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">{missingCount} recorded source{missingCount === 1 ? " is" : "s are"} no longer available.</p> : null}
    </div>
  );
}

export function ChatContextPanelContent({ view }: { view: Exclude<ChatPanelView, null> }) {
  if (view.mode === "review") return <ReviewPanel aiRunId={view.aiRunId} />;
  return <SourcesPanel messageId={view.messageId} focusNodeId={view.focusNodeId} />;
}
