import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-xl border border-border/40 bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
