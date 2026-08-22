import type { ReactNode } from "react";

import { Icon, type IconData } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export function WorkspaceFrame({
  collection,
  detail,
  className,
}: {
  collection: ReactNode;
  detail: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid min-h-[calc(100svh-7.5rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:grid-cols-[minmax(360px,0.92fr)_minmax(440px,1.08fr)]", className)}>
      <div className="min-w-0 bg-muted/20">{collection}</div>
      <div className="min-w-0 border-t border-border bg-card lg:border-t-0 lg:border-l">{detail}</div>
    </section>
  );
}

export function WorkspacePaneHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-[76px] items-center justify-between gap-4 border-b border-border bg-card px-5 py-4 sm:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-[-0.03em] text-foreground">{title}</h1>
        {description ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export type SegmentOption<T extends string> = { value: T; label: string };

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-xl bg-muted p-1", className)} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-8 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
            value === option.value && "bg-card text-foreground shadow-xs",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function CollectionSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
        {count !== undefined ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{count}</span> : null}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function CollectionRow({
  icon,
  title,
  summary,
  metadata,
  badge,
  selected = false,
  onClick,
}: {
  icon: IconData;
  title: ReactNode;
  summary?: ReactNode;
  metadata?: ReactNode;
  badge?: ReactNode;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group w-full rounded-xl border bg-card px-4 py-3.5 text-left shadow-xs transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-foreground/15 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25",
        selected ? "border-primary/35 shadow-sm ring-1 ring-primary/10" : "border-border",
      )}
    >
      <span className="flex items-start gap-3">
        <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground", selected && "bg-primary/10 text-primary")}>
          <Icon icon={icon} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-3">
            <span className="truncate text-sm font-semibold text-foreground">{title}</span>
            {badge ? <span className="shrink-0">{badge}</span> : null}
          </span>
          {summary ? <span className="mt-1 block truncate text-xs text-muted-foreground">{summary}</span> : null}
          {metadata ? <span className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">{metadata}</span> : null}
        </span>
      </span>
    </button>
  );
}

export function SoftBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "blue" | "green" | "rose" | "amber" }) {
  return (
    <span className={cn(
      "inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-medium capitalize",
      tone === "neutral" && "bg-muted text-muted-foreground",
      tone === "blue" && "bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
      tone === "green" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
      tone === "rose" && "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300",
      tone === "amber" && "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
    )}>{children}</span>
  );
}

export function DetailSection({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function PropertyRow({ icon, label, value }: { icon?: IconData; label: ReactNode; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-4 py-2 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">{icon ? <Icon icon={icon} className="size-4" /> : null}{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  );
}

export function WorkspaceEmptyState({ icon, title, description, action }: { icon: IconData; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="grid min-h-56 place-items-center px-6 py-10 text-center">
      <div className="max-w-xs">
        <span className="mx-auto grid size-10 place-items-center rounded-xl bg-foreground text-background"><Icon icon={icon} className="size-5" /></span>
        <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}
