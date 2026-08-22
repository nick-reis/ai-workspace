import Activity01Icon from "@hugeicons/core-free-icons/Activity01Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import UndoIcon from "@hugeicons/core-free-icons/UndoIcon";

import { Button } from "@/components/ui/button";
import { Icon, type IconData } from "@/components/ui/icon";
import { SoftBadge } from "@/components/workspace/workspace-view";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/date-format";
import type { ActivityAction, ActivityItem, ActivityState } from "@/types/graph";
import { activityState } from "./activity-api";

const stateLabels: Record<ActivityState, string> = {
  pending: "Needs review",
  applied: "Applied",
  rejected: "Rejected",
  superseded: "Superseded",
  undone: "Undone",
};

const stateTones: Record<ActivityState, "amber" | "green" | "rose" | "neutral"> = {
  pending: "amber",
  applied: "green",
  rejected: "rose",
  superseded: "neutral",
  undone: "neutral",
};

function presentation(item: ActivityItem): { eyebrow: string; title: string; description: string | null; icon: IconData } {
  if (item.kind === "memory_proposal") return {
    eyebrow: item.action === "update" ? "Memory update" : "Memory suggestion",
    title: item.title,
    description: item.statement,
    icon: SparklesIcon,
  };
  if (item.kind === "relationship_proposal") return {
    eyebrow: "Relationship suggestion",
    title: `${item.source_title} → ${item.target_title}`,
    description: `${item.relationship_type.replaceAll("_", " ")}${item.reason ? ` · ${item.reason}` : ""}`,
    icon: Link01Icon,
  };
  return {
    eyebrow: item.actor === "ai" ? "AI graph change" : `${item.actor} graph change`,
    title: item.operation.replaceAll("_", " "),
    description: item.reason,
    icon: Activity01Icon,
  };
}

function provenance(item: ActivityItem) {
  if (item.kind === "memory_proposal") return `${item.sources.length} message source${item.sources.length === 1 ? "" : "s"} · ${Math.round(item.confidence * 100)}% confidence`;
  if (item.kind === "relationship_proposal") return `AI proposal${item.confidence === null ? "" : ` · ${Math.round(item.confidence * 100)}% confidence`}`;
  return `Recorded by ${item.actor}`;
}

export function ActivityCard({
  item,
  onAction,
  busyAction,
  className,
}: {
  item: ActivityItem;
  onAction: (item: ActivityItem, action: ActivityAction) => void;
  busyAction?: ActivityAction | null;
  className?: string;
}) {
  const details = presentation(item);
  const state = activityState(item);
  const isBusy = Boolean(busyAction);

  return (
    <article className={cn("rounded-2xl border border-border/75 bg-card/75 p-4 shadow-xs backdrop-blur-xl", className)} aria-busy={isBusy}>
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Icon icon={details.icon} className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground">{details.eyebrow}</p>
            <SoftBadge tone={stateTones[state]}>{stateLabels[state]}</SoftBadge>
          </div>
          <h3 className="mt-2 text-sm font-semibold leading-5 text-foreground">{details.title}</h3>
          {details.description ? <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{details.description}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"><span>{provenance(item)}</span><span className="flex items-center gap-1"><Icon icon={Clock01Icon} className="size-3" />{relativeTime(item.created_at)}</span></div>
        </div>
      </div>

      {item.available_actions.length ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border/70 pt-3">
          {item.available_actions.includes("approve") ? <Button size="sm" disabled={isBusy} onClick={() => onAction(item, "approve")}><Icon icon={CheckmarkCircle02Icon} data-icon="inline-start" />{item.kind === "memory_proposal" ? "Remember" : "Approve"}</Button> : null}
          {item.available_actions.includes("reject") ? <Button size="sm" variant="outline" disabled={isBusy} onClick={() => onAction(item, "reject")}>{item.kind === "memory_proposal" ? "Don’t remember" : "Reject"}</Button> : null}
          {item.available_actions.includes("undo") ? <Button size="sm" variant="outline" disabled={isBusy} onClick={() => onAction(item, "undo")}><Icon icon={UndoIcon} data-icon="inline-start" />Undo</Button> : null}
        </div>
      ) : null}
    </article>
  );
}
