import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border bg-muted p-0.5 outline-none transition-[background-color,border-color] focus-visible:ring-3 focus-visible:ring-ring/20 data-checked:border-foreground data-checked:bg-foreground disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 rounded-full bg-card shadow-xs transition-transform duration-200 data-checked:translate-x-5 dark:data-checked:bg-background" />
    </SwitchPrimitive.Root>
  );
}
