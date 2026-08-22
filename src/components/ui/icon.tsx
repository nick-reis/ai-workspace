import {
  HugeiconsIcon,
  type HugeiconsIconProps,
  type IconSvgElement,
} from "@hugeicons/react";

function Icon({ strokeWidth = 2.5, ...props }: HugeiconsIconProps) {
  return (
    <HugeiconsIcon
      data-slot="icon"
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export { Icon, type IconSvgElement as IconData };
