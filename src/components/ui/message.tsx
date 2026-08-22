import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Message({ className, align = "start", ...props }: ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-align={align}
      className={cn("group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse", className)}
      {...props}
    />
  );
}

export function MessageContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex w-full min-w-0 flex-col gap-2.5 wrap-break-word", className)} {...props} />;
}
