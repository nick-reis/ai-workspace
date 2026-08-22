import { useInfiniteQuery } from "@tanstack/react-query";
import Activity01Icon from "@hugeicons/core-free-icons/Activity01Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import HistoryIcon from "@hugeicons/core-free-icons/HistoryIcon";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SegmentedControl,
  WorkspaceEmptyState,
  type SegmentOption,
} from "@/components/workspace/workspace-view";
import type { ActivityState } from "@/types/graph";
import { ActivityCard } from "./activity-card";
import { activityKeys, listActivityPage } from "./activity-api";
import { useActivityAction } from "./use-activity-action";

type HistoryFilter = "all" | ActivityState;

const filters: SegmentOption<HistoryFilter>[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Needs review" },
  { value: "applied", label: "Applied" },
  { value: "rejected", label: "Rejected" },
  { value: "superseded", label: "Superseded" },
  { value: "undone", label: "Undone" },
];

export function HistoryPage() {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const state = filter === "all" ? null : filter;
  const activity = useInfiniteQuery({
    queryKey: activityKeys.pages(state),
    queryFn: ({ pageParam }) => listActivityPage({ cursor: pageParam, state }),
    initialPageParam: null as { created_at: string; id: string } | null,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const action = useActivityAction(setActionError);
  const items = useMemo(() => activity.data?.pages.flatMap((page) => page.items) ?? [], [activity.data]);
  const total = activity.data?.pages[0]?.total_count ?? 0;

  return (
    <main className="mx-auto min-h-full w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-5 border-b border-border/70 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Icon icon={HistoryIcon} className="size-4" />Activity ledger</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-foreground">History</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Review what the AI proposed and inspect every auditable change made to your workspace.</p>
        </div>
        {!activity.isLoading ? <span className="text-sm text-muted-foreground">{total} record{total === 1 ? "" : "s"}</span> : null}
      </div>

      <div className="scroll-fade-x overflow-x-auto py-5">
        <SegmentedControl value={filter} options={filters} onChange={setFilter} />
      </div>

      {actionError ? <p role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{actionError}</p> : null}

      {activity.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div>
      ) : activity.error ? (
        <WorkspaceEmptyState icon={AlertCircleIcon} title="History unavailable" description={activity.error instanceof Error ? activity.error.message : "Your activity could not be loaded."} action={<Button size="sm" onClick={() => void activity.refetch()}>Try again</Button>} />
      ) : items.length ? (
        <div className="space-y-3">
          {items.map((item) => (
            <ActivityCard
              key={`${item.kind}:${item.id}`}
              item={item}
              busyAction={action.isPending && action.variables?.item.id === item.id ? action.variables.action : null}
              onAction={(target, nextAction) => { setActionError(null); action.mutate({ item: target, action: nextAction }); }}
            />
          ))}
          {activity.hasNextPage ? <div className="flex justify-center pt-3"><Button variant="outline" disabled={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>{activity.isFetchingNextPage ? "Loading…" : "Load older activity"}</Button></div> : null}
        </div>
      ) : (
        <WorkspaceEmptyState icon={filter === "all" ? HistoryIcon : Activity01Icon} title={filter === "all" ? "No activity yet" : `No ${filters.find((option) => option.value === filter)?.label.toLowerCase()} activity`} description={filter === "pending" ? "You’re all caught up." : "Auditable workspace changes will appear here."} />
      )}
    </main>
  );
}
