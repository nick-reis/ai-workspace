import HierarchyIcon from "@hugeicons/core-free-icons/HierarchyIcon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";

import { Icon } from "@/components/ui/icon";

import { GraphEngine } from "./graph-engine";
import type { GraphData } from "./types";

export function GraphLabPage({ data, isLoading = false, error }: { data?: GraphData; isLoading?: boolean; error?: string }) {
  return (
    <main className="h-full min-h-[460px] overflow-hidden bg-background text-foreground">
      <section className="h-full min-h-0">
        {isLoading ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground"><Icon icon={Loading03Icon} className="mr-2 inline size-4 animate-spin" /> Loading your graph…</div>
        ) : error ? (
          <div className="grid h-full place-items-center px-6 text-center"><div><p className="font-medium text-destructive">Your graph could not be loaded.</p><p className="mt-2 text-xs text-muted-foreground">{error}</p></div></div>
        ) : data?.nodes.length ? (
          <GraphEngine data={data} />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center"><div><Icon icon={HierarchyIcon} className="mx-auto mb-3 size-7 text-muted-foreground" /><p className="font-medium text-foreground">Your graph is empty.</p><p className="mt-1 text-xs text-muted-foreground">Graph data will appear here when it is available.</p></div></div>
        )}
      </section>
    </main>
  );
}
