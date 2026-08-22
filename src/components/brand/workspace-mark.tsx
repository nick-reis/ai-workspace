import AiBrain01Icon from "@hugeicons/core-free-icons/AiBrain01Icon";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export function WorkspaceMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl bg-foreground text-background shadow-xs",
        className,
      )}
    >
      <Icon icon={AiBrain01Icon} className="size-5" />
    </div>
  );
}
