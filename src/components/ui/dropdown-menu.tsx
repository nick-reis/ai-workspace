import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { cn } from "@/lib/utils";

function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

type DropdownMenuContentProps = MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
};

function DropdownMenuContent({
  align = "start",
  alignOffset,
  className,
  side = "bottom",
  sideOffset = 6,
  ...props
}: DropdownMenuContentProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="z-50 outline-hidden"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "min-w-48 origin-[var(--transform-origin)] rounded-xl border border-border/80 bg-popover/95 p-1.5 text-popover-foreground shadow-lg outline-hidden backdrop-blur-xl transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & { variant?: "default" | "destructive" }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        "flex min-h-9 cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-45 data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive/10 data-[variant=destructive]:data-highlighted:text-destructive [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "flex min-h-9 cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-45 data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuRadioItemIndicator({
  className,
  ...props
}: MenuPrimitive.RadioItemIndicator.Props) {
  return (
    <MenuPrimitive.RadioItemIndicator
      data-slot="dropdown-menu-radio-item-indicator"
      className={cn("grid size-4 shrink-0 place-items-center", className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-0.5 my-1 h-px bg-border/80", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
