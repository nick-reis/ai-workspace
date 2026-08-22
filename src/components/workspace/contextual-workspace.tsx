import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CollapseRail } from "@/components/ui/collapse-rail";
import { Icon } from "@/components/ui/icon";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ContextPanelCloseContext } from "@/components/workspace/contextual-workspace-context";
import { cn } from "@/lib/utils";

export type ContextPanelDefinition = {
  key: string;
  title: string;
  description?: string;
  ariaLabel?: string;
  content: ReactNode;
};

type ContextualWorkspaceProps = {
  children: ReactNode;
  panel: ContextPanelDefinition | null;
  onPanelClose: () => void;
  panelWidthStorageKey: string;
  className?: string;
  mainClassName?: string;
  defaultPanelWidth?: number;
  minPanelWidth?: number;
  maxPanelWidth?: number;
  closeSnapWidth?: number;
};

gsap.registerPlugin(CustomEase);
const PANEL_EASE = CustomEase.create("context-panel-snap", "0.16,1,0.3,1");

function storedPanelWidth(storageKey: string, fallback: number, minimum: number, maximum: number) {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = Number.parseFloat(window.localStorage.getItem(storageKey) ?? "");
    return Number.isFinite(stored) ? Math.min(maximum, Math.max(minimum, stored)) : fallback;
  } catch {
    return fallback;
  }
}

function useNarrowPanel() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}

function PanelFrame({ panel, onClose }: { panel: ContextPanelDefinition; onClose: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-start gap-3 border-b border-border/70 px-5 py-4">
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-foreground">{panel.title}</h2>{panel.description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{panel.description}</p> : null}</div>
        <Button aria-label="Close details" title="Close details" variant="ghost" size="icon-sm" onClick={onClose}><Icon icon={Cancel01Icon} /></Button>
      </div>
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><ContextPanelCloseContext.Provider value={onClose}>{panel.content}</ContextPanelCloseContext.Provider></div>
    </div>
  );
}

function DesktopContextPanel({
  panel,
  onClose,
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  closeSnapWidth,
}: {
  panel: ContextPanelDefinition | null;
  onClose: () => void;
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  closeSnapWidth: number;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const dragRef = useRef<{ startWidth: number } | null>(null);
  const lastOpenWidthRef = useRef(storedPanelWidth(storageKey, defaultWidth, minWidth, maxWidth));
  const initialPanelRef = useRef(panel);
  const panelRef = useRef(panel);
  const [retainedPanel, setRetainedPanel] = useState<ContextPanelDefinition | null>(panel);
  const displayPanel = panel ?? retainedPanel;
  const panelKey = panel?.key ?? "closed";

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    gsap.set(shell, { width: initialPanelRef.current ? lastOpenWidthRef.current : 0 });
  }, []);

  useLayoutEffect(() => {
    panelRef.current = panel;
  }, [panel]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const content = contentRef.current;
    if (!shell || !content) return;
    timelineRef.current?.kill();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduceMotion ? 0 : 0.62;

    const nextPanel = panelRef.current;
    if (nextPanel) {
      // Retain the last panel while the close animation runs.
      setRetainedPanel(nextPanel);
      timelineRef.current = gsap.timeline({ defaults: { ease: PANEL_EASE, overwrite: true } })
        .to(shell, { width: lastOpenWidthRef.current, duration }, 0)
        .fromTo(content, { autoAlpha: 0, x: 18 }, { autoAlpha: 1, x: 0, duration: reduceMotion ? 0 : 0.42 }, 0.1);
    } else {
      timelineRef.current = gsap.timeline({ defaults: { ease: PANEL_EASE, overwrite: true }, onComplete: () => setRetainedPanel(null) })
        .to(content, { autoAlpha: 0, x: 14, duration: reduceMotion ? 0 : 0.2 }, 0)
        .to(shell, { width: 0, duration }, 0);
    }
    return () => { timelineRef.current?.kill(); };
  }, [panelKey]);

  useEffect(() => () => { timelineRef.current?.kill(); }, []);

  const startDrag = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    timelineRef.current?.kill();
    dragRef.current = { startWidth: shell.getBoundingClientRect().width };
  }, []);

  const drag = useCallback((deltaX: number) => {
    const shell = shellRef.current;
    const session = dragRef.current;
    if (!shell || !session) return;
    gsap.set(shell, { width: Math.min(maxWidth, Math.max(0, session.startWidth + deltaX)) });
  }, [maxWidth]);

  const finishDrag = useCallback(() => {
    const shell = shellRef.current;
    const session = dragRef.current;
    if (!shell || !session) return;
    const currentWidth = shell.getBoundingClientRect().width;
    dragRef.current = null;
    if (currentWidth < closeSnapWidth) {
      onClose();
      return;
    }
    const target = Math.min(maxWidth, Math.max(minWidth, currentWidth));
    lastOpenWidthRef.current = target;
    try { window.localStorage.setItem(storageKey, String(target)); } catch { /* Persistence is best-effort. */ }
    gsap.to(shell, { width: target, duration: 0.35, ease: PANEL_EASE, overwrite: true });
  }, [closeSnapWidth, maxWidth, minWidth, onClose, storageKey]);

  return (
    <div ref={shellRef} className="relative hidden h-full shrink-0 overflow-hidden lg:block" aria-hidden={!displayPanel}>
      {displayPanel ? <aside ref={contentRef} className="h-full border-l border-border/70" style={{ minWidth }} aria-label={displayPanel.ariaLabel ?? displayPanel.title}><PanelFrame panel={displayPanel} onClose={onClose} /></aside> : null}
      {displayPanel ? <CollapseRail collapsed={false} onCollapsedChange={(collapsed) => { if (collapsed) onClose(); }} side="right" label="Resize details sidebar" activation="double-click" closeOnly onRailDragStart={startDrag} onDragChange={drag} onDragEnd={finishDrag} className="absolute inset-y-0 -left-2 z-50 w-4 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-border" /> : null}
    </div>
  );
}

export function ContextualWorkspace({
  children,
  panel,
  onPanelClose,
  panelWidthStorageKey,
  className,
  mainClassName,
  defaultPanelWidth = 420,
  minPanelWidth = 320,
  maxPanelWidth = 640,
  closeSnapWidth = 180,
}: ContextualWorkspaceProps) {
  const narrow = useNarrowPanel();
  return (
    <section className={cn("flex h-full min-h-0 min-w-0 overflow-hidden bg-background", className)}>
      <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", mainClassName)}>{children}</div>
      {narrow ? (
        panel ? <Sheet open onOpenChange={(open) => { if (!open) onPanelClose(); }}><SheetContent side="right" showCloseButton={false} className="w-[92vw] max-w-[440px] p-0"><SheetHeader className="sr-only"><SheetTitle>{panel.title}</SheetTitle><SheetDescription>{panel.description ?? panel.title}</SheetDescription></SheetHeader><PanelFrame panel={panel} onClose={onPanelClose} /></SheetContent></Sheet> : null
      ) : <DesktopContextPanel panel={panel} onClose={onPanelClose} storageKey={panelWidthStorageKey} defaultWidth={defaultPanelWidth} minWidth={minPanelWidth} maxWidth={maxPanelWidth} closeSnapWidth={closeSnapWidth} />}
    </section>
  );
}
