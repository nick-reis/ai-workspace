import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

import { CollapseRail } from "@/components/ui/collapse-rail";
import { cn } from "@/lib/utils";

const DIRECTORY_DEFAULT_WIDTH_REM = 17;
const DIRECTORY_MIN_WIDTH_REM = 12;
const DIRECTORY_MAX_WIDTH_REM = 32;
const DIRECTORY_CLOSE_SNAP_REM = 6;
const DIRECTORY_WIDTH_STORAGE_PREFIX = "directory_sidebar_width";

gsap.registerPlugin(CustomEase);
const DIRECTORY_SNAP_EASE = CustomEase.create("directory-snap", "0.16,1,0.3,1");

type Props = {
  label: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  tools?: ReactNode;
  children: ReactNode;
  directoryRef?: Ref<HTMLDivElement>;
  directoryClassName?: string;
};

export function CollapsibleDirectoryPanel({ label, collapsed, onCollapsedChange, tools, children, directoryRef, directoryClassName }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const dragSessionRef = useRef<{ layout: HTMLElement; startWidth: number; minWidth: number; maxWidth: number; closeSnapWidth: number } | null>(null);
  const snapTweenRef = useRef<gsap.core.Tween | null>(null);
  const lastOpenWidthRef = useRef<number | null>(null);
  const widthStorageKey = `${DIRECTORY_WIDTH_STORAGE_PREFIX}:${label}`;

  const persistWidth = useCallback((width: number) => {
    try { window.localStorage.setItem(widthStorageKey, String(width)); } catch { /* Persistence is best-effort. */ }
  }, [widthStorageKey]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const layout = panel?.parentElement;
    if (!layout) return;
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    let storedWidth = Number.NaN;
    try { storedWidth = Number.parseFloat(window.localStorage.getItem(widthStorageKey) ?? ""); } catch { /* Use the default width. */ }
    const openWidth = Number.isFinite(storedWidth)
      ? Math.min(DIRECTORY_MAX_WIDTH_REM * rootFontSize, Math.max(DIRECTORY_MIN_WIDTH_REM * rootFontSize, storedWidth))
      : DIRECTORY_DEFAULT_WIDTH_REM * rootFontSize;
    lastOpenWidthRef.current = openWidth;
    layout.style.setProperty("--directory-panel-width", `${collapsed ? 0 : openWidth}px`);
  }, [collapsed, widthStorageKey]);

  useEffect(() => () => { snapTweenRef.current?.kill(); }, []);

  const startDrag = useCallback(() => {
    const panel = panelRef.current;
    const layout = panel?.parentElement;
    if (!panel || !layout) return;
    snapTweenRef.current?.kill();
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    dragSessionRef.current = {
      layout,
      startWidth: panel.getBoundingClientRect().width,
      minWidth: DIRECTORY_MIN_WIDTH_REM * rootFontSize,
      maxWidth: DIRECTORY_MAX_WIDTH_REM * rootFontSize,
      closeSnapWidth: DIRECTORY_CLOSE_SNAP_REM * rootFontSize,
    };
    if (collapsed) onCollapsedChange(false);
  }, [collapsed, onCollapsedChange]);

  const drag = useCallback((deltaX: number) => {
    const session = dragSessionRef.current;
    if (!session) return;
    const width = Math.min(session.maxWidth, Math.max(0, session.startWidth + deltaX));
    session.layout.style.setProperty("--directory-panel-width", `${width}px`);
  }, []);

  const finishDrag = useCallback(() => {
    const session = dragSessionRef.current;
    if (!session) return;
    const currentWidth = Number.parseFloat(getComputedStyle(session.layout).getPropertyValue("--directory-panel-width")) || 0;
    const closing = currentWidth < session.closeSnapWidth;
    const targetWidth = closing ? 0 : Math.min(session.maxWidth, Math.max(session.minWidth, currentWidth));
    if (!closing) {
      lastOpenWidthRef.current = targetWidth;
      persistWidth(targetWidth);
    }
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const fullDistance = DIRECTORY_DEFAULT_WIDTH_REM * rootFontSize;
    const distance = Math.abs(targetWidth - currentWidth);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduceMotion ? 0 : Math.min(0.7, Math.max(0.2, 0.7 * distance / fullDistance));
    if (!closing) onCollapsedChange(false);
    snapTweenRef.current?.kill();
    snapTweenRef.current = gsap.to(session.layout, {
      "--directory-panel-width": `${targetWidth}px`,
      duration,
      ease: DIRECTORY_SNAP_EASE,
      overwrite: true,
      onComplete: () => {
        if (closing) onCollapsedChange(true);
        snapTweenRef.current = null;
      },
    });
    dragSessionRef.current = null;
  }, [onCollapsedChange, persistWidth]);

  const toggleFromRail = useCallback((nextCollapsed: boolean) => {
    const panel = panelRef.current;
    const layout = panel?.parentElement;
    if (!panel || !layout) return;
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const currentWidth = panel.getBoundingClientRect().width;
    if (nextCollapsed && currentWidth > 0) {
      const openWidth = Math.min(DIRECTORY_MAX_WIDTH_REM * rootFontSize, Math.max(DIRECTORY_MIN_WIDTH_REM * rootFontSize, currentWidth));
      lastOpenWidthRef.current = openWidth;
      persistWidth(openWidth);
    }
    const targetWidth = nextCollapsed ? 0 : lastOpenWidthRef.current ?? DIRECTORY_DEFAULT_WIDTH_REM * rootFontSize;
    const fullDistance = DIRECTORY_DEFAULT_WIDTH_REM * rootFontSize;
    const distance = Math.abs(targetWidth - currentWidth);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduceMotion ? 0 : Math.min(0.7, Math.max(0.2, 0.7 * distance / fullDistance));
    if (!nextCollapsed) onCollapsedChange(false);
    snapTweenRef.current?.kill();
    snapTweenRef.current = gsap.to(layout, {
      "--directory-panel-width": `${targetWidth}px`,
      duration,
      ease: DIRECTORY_SNAP_EASE,
      overwrite: true,
      onComplete: () => {
        if (nextCollapsed) onCollapsedChange(true);
        snapTweenRef.current = null;
      },
    });
  }, [onCollapsedChange, persistWidth]);

  return (
    <aside ref={panelRef} className={cn("relative z-30 flex max-h-52 min-h-0 min-w-0 flex-col overflow-visible border-b bg-muted/10 lg:max-h-none lg:w-(--directory-panel-width) lg:border-b-0 lg:border-r", collapsed ? "border-transparent" : "border-border")}>
      <div className="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        {tools ? (
          <div className="relative z-10 flex h-12 w-full min-w-0 shrink-0 items-center overflow-hidden border-b border-border px-3">
            <div className="flex shrink-0 items-center gap-1">{tools}</div>
          </div>
        ) : null}
        <div className="relative z-10 min-h-0 min-w-0 flex-1 overflow-hidden">
          <div ref={directoryRef} className={cn("size-full min-h-0 min-w-0", directoryClassName, collapsed && "invisible")} aria-hidden={collapsed}>
            {children}
          </div>
        </div>
      </div>
      <CollapseRail
        collapsed={collapsed}
        onCollapsedChange={toggleFromRail}
        label={`Resize ${label}`}
        activation="double-click"
        onRailDragStart={startDrag}
        onDragChange={drag}
        onDragEnd={finishDrag}
        className="pointer-events-auto absolute inset-y-0 -right-2 z-50 hidden w-4 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-border lg:block"
      />
    </aside>
  );
}
