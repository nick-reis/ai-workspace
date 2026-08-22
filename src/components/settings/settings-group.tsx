import type { ReactNode } from "react";

import { Icon, type IconData } from "@/components/ui/icon";

export function SettingsGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 px-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/75 shadow-xs backdrop-blur-xl divide-y divide-border/70">{children}</div>
    </section>
  );
}

export function SettingRow({ icon, title, description, control }: { icon: IconData; title: string; description: string; control: ReactNode }) {
  return (
    <div className="flex min-h-20 items-center gap-4 px-4 py-4 sm:px-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/70 bg-muted/70 text-muted-foreground shadow-2xs">
        <Icon icon={icon} className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
