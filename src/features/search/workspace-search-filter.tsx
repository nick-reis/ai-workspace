import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import { gsap } from "gsap";
import { useLayoutEffect, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";

import {
  getWorkspaceSearchFilter,
  workspaceSearchFilters,
  type WorkspaceSearchFilter,
} from "./workspace-search-filters";

export function AnimatedFilterLabel({ value }: { value: WorkspaceSearchFilter }) {
  const [transition, setTransition] = useState<{
    current: WorkspaceSearchFilter;
    outgoing: WorkspaceSearchFilter | null;
  }>({ current: value, outgoing: null });
  const incomingRef = useRef<HTMLSpanElement>(null);
  const outgoingRef = useRef<HTMLSpanElement>(null);

  if (transition.current !== value) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTransition({
      current: value,
      outgoing: reduceMotion ? null : transition.current,
    });
  }

  useLayoutEffect(() => {
    if (!transition.outgoing) return;
    const timeline = gsap.timeline({
      onComplete: () => {
        setTransition((current) => current.current === value
          ? { ...current, outgoing: null }
          : current);
      },
    });
    timeline
      .fromTo(
        incomingRef.current,
        { autoAlpha: 0, y: -8 },
        { autoAlpha: 1, y: 0, duration: 0.2, ease: "power2.out" },
        0,
      )
      .fromTo(
        outgoingRef.current,
        { autoAlpha: 1, y: 0 },
        { autoAlpha: 0, y: 8, duration: 0.2, ease: "power2.out" },
        0,
      );
    return () => { timeline.kill(); };
  }, [transition.outgoing, value]);

  const incoming = getWorkspaceSearchFilter(value);
  const outgoing = transition.outgoing ? getWorkspaceSearchFilter(transition.outgoing) : null;

  return (
    <span className="relative block h-5 min-w-24 overflow-hidden">
      <span ref={incomingRef} className="flex h-5 items-center gap-1.5">
        <Icon icon={incoming.icon} />
        <span>{incoming.label}</span>
      </span>
      {outgoing ? (
        <span ref={outgoingRef} aria-hidden className="absolute inset-0 flex h-5 items-center gap-1.5">
          <Icon icon={outgoing.icon} />
          <span>{outgoing.label}</span>
        </span>
      ) : null}
    </span>
  );
}

export function WorkspaceSearchFilterMenu({
  value,
  onValueChange,
}: {
  value: WorkspaceSearchFilter;
  onValueChange: (value: WorkspaceSearchFilter) => void;
}) {
  const selected = getWorkspaceSearchFilter(value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Filter nodes: ${selected.label}`}
        className={buttonVariants({ variant: "outline", size: "sm", className: "justify-between" })}
      >
        <AnimatedFilterLabel value={value} />
        <Icon icon={ArrowDown01Icon} data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => onValueChange(nextValue as WorkspaceSearchFilter)}
        >
          {workspaceSearchFilters.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
              <DropdownMenuRadioItemIndicator>
                <span className="size-1.5 rounded-full bg-current" />
              </DropdownMenuRadioItemIndicator>
              <Icon icon={option.icon} />
              <span className="flex-1">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
