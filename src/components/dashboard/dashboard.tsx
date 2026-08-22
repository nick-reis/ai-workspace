import type { ReactNode } from "react";

import { Icon, type IconData } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function DashboardPage({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <main className={cn("mx-auto w-full max-w-[1560px] space-y-5 p-4 sm:p-6 lg:space-y-6 lg:p-8", className)}>
      {children}
    </main>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 pb-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">{eyebrow}</div> : null}
        <h1 className="text-3xl font-medium tracking-[-0.045em] text-foreground sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function DashboardPanel({
  title,
  description,
  action,
  className,
  contentClassName,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-border/80 bg-card/80 shadow-sm", className)}>
      {title || description || action ? (
        <div className="flex min-h-16 items-center justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="min-w-0">
            {title ? <h2 className="truncate text-base font-semibold tracking-tight text-card-foreground">{title}</h2> : null}
            {description ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn("p-5", contentClassName)}>{children}</div>
    </section>
  );
}

export function MetricCard({
  icon,
  label,
  value,
  detail,
  accent = false,
  loading = false,
}: {
  icon: IconData;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  accent?: boolean;
  loading?: boolean;
}) {
  return (
    <article className={cn("group relative min-h-36 overflow-hidden rounded-2xl border border-border/80 bg-card/75 p-4 shadow-sm transition-colors hover:border-border sm:p-5", accent && "border-primary/25 bg-primary/[0.055]")}> 
      <div className={cn("mb-5 grid size-9 place-items-center rounded-xl border border-border/70 bg-secondary text-muted-foreground sm:mb-7", accent && "border-primary/25 bg-primary/10 text-primary")}> 
        <Icon icon={icon} className="size-[18px]" />
      </div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {loading ? <Skeleton className="mt-2 h-8 w-20" /> : <p className="mt-1 text-2xl font-medium tracking-[-0.04em] text-card-foreground sm:text-[1.75rem]">{value}</p>}
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
      <div className={cn("absolute inset-x-5 bottom-0 h-px bg-linear-to-r from-transparent via-border to-transparent", accent && "via-primary/55")} />
    </article>
  );
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "primary" | "success" | "warning" }) {
  return (
    <span className={cn(
      "inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium",
      tone === "neutral" && "border-border/70 bg-secondary text-muted-foreground",
      tone === "primary" && "border-primary/25 bg-primary/10 text-primary",
      tone === "success" && "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
      tone === "warning" && "border-amber-400/20 bg-amber-400/10 text-amber-300",
    )}>
      {children}
    </span>
  );
}

export function DashboardListItem({
  icon,
  title,
  description,
  meta,
  trailing,
  onClick,
}: {
  icon?: IconData;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      {icon ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/70 bg-secondary/80 text-muted-foreground">
          <Icon icon={icon} className="size-4" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {meta ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
        </span>
        {description ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span> : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </>
  );

  const classes = "flex w-full items-center gap-3 rounded-xl px-2 py-2.5 transition-colors";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(classes, "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30")}>{content}</button>
  ) : (
    <div className={classes}>{content}</div>
  );
}

export function DashboardEmptyState({ icon, title, description }: { icon: IconData; title: string; description: string }) {
  return (
    <div className="grid min-h-44 place-items-center px-5 py-8 text-center">
      <div>
        <span className="mx-auto grid size-10 place-items-center rounded-xl border border-border/70 bg-secondary text-muted-foreground"><Icon icon={icon} className="size-5" /></span>
        <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
