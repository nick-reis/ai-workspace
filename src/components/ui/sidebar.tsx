"use client"

import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon"
import { cva, type VariantProps } from "class-variance-authority"
import { gsap } from "gsap"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { CollapseRail } from "@/components/ui/collapse-rail"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"
const SIDEBAR_OPEN_STORAGE_KEY = "app_sidebar_open"
const SIDEBAR_WIDTH_STORAGE_KEY = "app_sidebar_width"
const SIDEBAR_MIN_RESIZABLE_REM = 12
const SIDEBAR_MAX_RESIZABLE_REM = 32
const SIDEBAR_COLLAPSE_SNAP_REM = 12
const SIDEBAR_COLLAPSE_VISUAL_START_REM = 8

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)
  const [sidebarWidth, setSidebarWidthState] = React.useState(() => {
    if (typeof window === "undefined") return 256
    try {
      const stored = Number.parseFloat(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? "")
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      return Number.isFinite(stored)
        ? Math.min(SIDEBAR_MAX_RESIZABLE_REM * rootFontSize, Math.max(SIDEBAR_MIN_RESIZABLE_REM * rootFontSize, stored))
        : 256
    } catch {
      return 256
    }
  })
  const setSidebarWidth = React.useCallback((width: number) => {
    setSidebarWidthState(width)
    try { window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width)) } catch { /* Persistence is best-effort when storage is unavailable. */ }
  }, [])

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(() => {
    if (typeof window === "undefined") return defaultOpen
    try {
      const stored = window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)
      return stored === null ? defaultOpen : stored === "true"
    } catch {
      return defaultOpen
    }
  })
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      try { window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(openState)) } catch { /* Persistence is best-effort when storage is unavailable. */ }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
      sidebarWidth,
      setSidebarWidth,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar, sidebarWidth, setSidebarWidth]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": `${sidebarWidth}px`,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  dir,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          dir={dir}
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="w-(--sidebar-width) bg-sidebar/95 p-0 text-sidebar-foreground backdrop-blur-xl [&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-700 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-0",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
        )}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "fixed top-(--window-titlebar-height) bottom-0 z-10 hidden h-[calc(100svh-var(--window-titlebar-height))] w-(--sidebar-width) transition-[left,right,width] duration-700 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-0 data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] md:flex",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex size-full flex-col bg-sidebar group-data-[variant=floating]:rounded-2xl group-data-[variant=floating]:shadow-lg group-data-[variant=floating]:ring-1 group-data-[variant=floating]:ring-sidebar-border"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <Icon icon={SidebarLeftIcon} />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarRail({
  className,
  onPointerEnter,
  onPointerLeave,
  ...props
}: Omit<React.ComponentProps<"button">, "onDragEnd">) {
  const { state, setOpen, setSidebarWidth } = useSidebar()
  const collapsed = state === "collapsed"
  const [railHovered, setRailHovered] = React.useState(false)
  const dragSessionRef = React.useRef<{
    gap: HTMLElement
    container: HTMLElement
    wrapper: HTMLElement
    startGapWidth: number
    collapsedGapWidth: number
    collapsedContainerWidth: number
    minResizableWidth: number
    maxResizableWidth: number
    collapseSnapWidth: number
    collapseVisualStartWidth: number
    sidebar: HTMLElement
    collapseTimeline: gsap.core.Timeline
  } | null>(null)

  const applyDragCollapseProgress = React.useCallback((session: NonNullable<typeof dragSessionRef.current>, width: number) => {
    const range = Math.max(1, session.collapseVisualStartWidth - session.collapsedGapWidth)
    const progress = Math.min(1, Math.max(0, (session.collapseVisualStartWidth - width) / range))
    session.collapseTimeline.progress(progress)
  }, [])

  const startDrag = React.useCallback((rail: HTMLButtonElement) => {
    setRailHovered(false)
    const sidebar = rail.closest<HTMLElement>("[data-slot=sidebar]")
    const gap = sidebar?.querySelector<HTMLElement>(":scope > [data-slot=sidebar-gap]")
    const container = sidebar?.querySelector<HTMLElement>(":scope > [data-slot=sidebar-container]")
    const wrapper = sidebar?.closest<HTMLElement>("[data-slot=sidebar-wrapper]")
    if (!sidebar || !gap || !container || !wrapper) return
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const inset = sidebar.dataset.variant === "inset" || sidebar.dataset.variant === "floating"
    const collapsedGapWidth = (inset ? 4 : 3) * rootFontSize
    const collapsedContainerWidth = collapsedGapWidth + (inset ? 2 : 0)
    const labels = Array.from(sidebar.querySelectorAll<HTMLElement>('[data-sidebar="group-label"]'))
    const buttons = Array.from(sidebar.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]'))
    const text = Array.from(sidebar.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"] > span:last-child, [data-sidebar="menu-button"] > div:nth-child(2)'))
    const defaultButtons = buttons.filter((button) => button.dataset.size !== "lg")
    const largeButtons = buttons.filter((button) => button.dataset.size === "lg")
    const collapseTimeline = gsap.timeline({ paused: true, defaults: { duration: 1, ease: "none" } })
    collapseTimeline.set([...labels, ...buttons, ...text], { transition: "none" }, 0)
    collapseTimeline.fromTo(labels, { opacity: 1, marginTop: 0 }, { opacity: 0, marginTop: -32, immediateRender: false }, 0)
    collapseTimeline.fromTo(text, { autoAlpha: 1 }, { autoAlpha: 0, immediateRender: false }, 0)
    collapseTimeline.fromTo(defaultButtons, { height: 36, paddingLeft: 12, paddingRight: 12 }, { height: 32, paddingLeft: 8, paddingRight: 8, immediateRender: false }, 0)
    collapseTimeline.fromTo(largeButtons, { height: 56, paddingLeft: 12, paddingRight: 12 }, { height: 32, paddingLeft: 0, paddingRight: 0, immediateRender: false }, 0)
    dragSessionRef.current = {
      gap,
      container,
      wrapper,
      startGapWidth: gap.getBoundingClientRect().width,
      collapsedGapWidth,
      collapsedContainerWidth,
      minResizableWidth: SIDEBAR_MIN_RESIZABLE_REM * rootFontSize,
      maxResizableWidth: SIDEBAR_MAX_RESIZABLE_REM * rootFontSize,
      collapseSnapWidth: SIDEBAR_COLLAPSE_SNAP_REM * rootFontSize,
      collapseVisualStartWidth: SIDEBAR_COLLAPSE_VISUAL_START_REM * rootFontSize,
      sidebar,
      collapseTimeline,
    }
    sidebar.dataset.collapsible = ""
    gap.style.transition = "none"
    container.style.transition = "none"
    applyDragCollapseProgress(dragSessionRef.current, gap.getBoundingClientRect().width)
  }, [applyDragCollapseProgress])

  const drag = React.useCallback((deltaX: number) => {
    const session = dragSessionRef.current
    if (!session) return
    const gapWidth = Math.min(session.maxResizableWidth, Math.max(session.collapsedGapWidth, session.startGapWidth + deltaX))
    const openRange = Math.max(1, session.startGapWidth - session.collapsedGapWidth)
    const progress = Math.min(1, Math.max(0, (gapWidth - session.collapsedGapWidth) / openRange))
    const containerOffset = session.collapsedContainerWidth - session.collapsedGapWidth
    const containerWidth = gapWidth + containerOffset * (1 - progress)
    session.gap.style.width = `${gapWidth}px`
    session.container.style.width = `${containerWidth}px`
    applyDragCollapseProgress(session, gapWidth)
  }, [applyDragCollapseProgress])

  const finishDrag = React.useCallback((_deltaX: number, dragged: boolean) => {
    const session = dragSessionRef.current
    if (!session) return
    if (!dragged) {
      session.sidebar.dataset.collapsible = collapsed ? "icon" : ""
      session.gap.style.removeProperty("transition")
      session.container.style.removeProperty("transition")
      session.collapseTimeline.revert()
      session.collapseTimeline.kill()
      dragSessionRef.current = null
      return
    }
    const currentWidth = session.gap.getBoundingClientRect().width
    const shouldCollapse = currentWidth < session.collapseSnapWidth
    if (!shouldCollapse) {
      const nextWidth = Math.min(session.maxResizableWidth, Math.max(session.minResizableWidth, currentWidth))
      session.wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`)
      setSidebarWidth(nextWidth)
    }
    setOpen(!shouldCollapse)
    session.sidebar.dataset.collapsible = shouldCollapse ? "icon" : ""
    window.requestAnimationFrame(() => {
      session.gap.style.removeProperty("transition")
      session.container.style.removeProperty("transition")
      session.gap.style.removeProperty("width")
      session.container.style.removeProperty("width")
      session.collapseTimeline.revert()
      session.collapseTimeline.kill()
      dragSessionRef.current = null
    })
  }, [collapsed, setOpen, setSidebarWidth])

  return (
    <CollapseRail
      data-sidebar="rail"
      data-slot="sidebar-rail"
      collapsed={collapsed}
      onCollapsedChange={(nextCollapsed) => setOpen(!nextCollapsed)}
      label="Toggle sidebar"
      activation="double-click"
      onRailDragStart={startDrag}
      onDragChange={drag}
      onDragEnd={finishDrag}
      onPointerEnter={(event) => {
        setRailHovered(true)
        onPointerEnter?.(event)
      }}
      onPointerLeave={(event) => {
        setRailHovered(false)
        onPointerLeave?.(event)
      }}
      className={cn(
        "absolute inset-y-0 z-20 hidden w-4 touch-none select-none border-0 bg-transparent p-0 outline-none transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex ltr:-translate-x-1/2 rtl:-translate-x-1/2",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "group-data-[collapsible=offcanvas]:translate-x-0",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 start-1/2 w-px -translate-x-1/2 rounded-full bg-transparent transition-colors duration-150",
          railHovered && "bg-sidebar-border"
        )}
      />
    </CollapseRail>
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "relative flex w-full flex-1 flex-col bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn("h-8 w-full bg-background shadow-none", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn(
        "flex flex-col gap-2 p-2 [--radius:var(--radius-xl)]",
        className
      )}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-auto [--radius:var(--radius-xl)] group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "flex h-8 shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-sidebar-foreground/45 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-500 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-0 group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-group-label",
      sidebar: "group-label",
    },
  })
}

function SidebarGroupAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-group-action",
      sidebar: "group-action",
    },
  })
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-xl border border-transparent px-3 py-2 text-left text-sm font-normal text-sidebar-foreground/65 ring-sidebar-ring outline-hidden transition-[width,height,padding,background-color,border-color,color] duration-200 group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-lg! group-data-[collapsible=icon]:p-[7px]! hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/30 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground data-active:border-sidebar-border data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground py-4 ",
        outline:
          "bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
      size: {
        default: "h-9 text-sm",
        sm: "h-8 text-sm",
        lg: "h-14 px-3 text-sm group-data-[collapsible=icon]:border-0! group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  render,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    isActive?: boolean
    tooltip?: string | React.ComponentProps<typeof TooltipContent>
  } & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { isMobile, state } = useSidebar()
  const comp = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(sidebarMenuButtonVariants({ variant, size }), className),
      },
      props
    ),
    render: !tooltip ? render : <TooltipTrigger render={render} />,
    state: {
      slot: "sidebar-menu-button",
      sidebar: "menu-button",
      size,
      active: isActive,
    },
  })

  if (!tooltip) {
    return comp
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      {comp}
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

function SidebarMenuAction({
  className,
  render,
  showOnHover = false,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    showOnHover?: boolean
  }) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-2 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
          showOnHover &&
            "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground aria-expanded:opacity-100 md:opacity-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-menu-action",
      sidebar: "menu-action",
    },
  })
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 peer-data-active/menu-button:text-sidebar-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {
  // Random width between 50 to 90%.
  const [width] = React.useState(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  })

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  render,
  size = "md",
  isActive = false,
  className,
  ...props
}: useRender.ComponentProps<"a"> &
  React.ComponentProps<"a"> & {
    size?: "sm" | "md"
    isActive?: boolean
  }) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      {
        className: cn(
          "flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground ring-sidebar-ring outline-hidden group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[size=md]:text-sm data-[size=sm]:text-xs data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-menu-sub-button",
      sidebar: "menu-sub-button",
      size,
      active: isActive,
    },
  })
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}
