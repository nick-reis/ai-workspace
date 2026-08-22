import { gsap } from "gsap";
import { useLayoutEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type StaggerChildrenProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  ready?: boolean;
  stagger?: number;
  y?: number;
};

export function StaggerChildren({
  children,
  className,
  delay = 0.08,
  duration = 0.44,
  ready = true,
  stagger = 0.07,
  y = 12,
}: StaggerChildrenProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!ready) return;
    const container = containerRef.current;
    if (!container || !container.children.length) return;
    const items = Array.from(container.children);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tween = gsap.fromTo(
      items,
      { autoAlpha: 0, y: reduceMotion ? 0 : y },
      {
        autoAlpha: 1,
        y: 0,
        delay: reduceMotion ? 0 : delay,
        duration: reduceMotion ? 0 : duration,
        stagger: reduceMotion ? 0 : stagger,
        ease: "power3.out",
        clearProps: "opacity,transform,visibility",
      },
    );
    return () => { tween.kill(); };
  }, [delay, duration, ready, stagger, y]);

  return <div ref={containerRef} className={cn(className)}>{children}</div>;
}
