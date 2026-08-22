import { useCallback, useRef, type ComponentProps, type PointerEvent as ReactPointerEvent } from "react"

import { cn } from "@/lib/utils"

type Props = Omit<ComponentProps<"button">, "onChange" | "onDragEnd"> & {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  side?: "left" | "right"
  label?: string
  closeOnly?: boolean
  onDragChange?: (deltaX: number) => void
  onDragEnd?: (deltaX: number, dragged: boolean) => void
  onRailDragStart?: (rail: HTMLButtonElement) => void
  activation?: "click" | "double-click" | "none"
}

export function CollapseRail({ collapsed, onCollapsedChange, side = "left", label = "Toggle sidebar", closeOnly = false, onRailDragStart, onDragChange, onDragEnd, activation = "click", className, onClick, onDoubleClick, onPointerDown, ...props }: Props) {
  const draggedRef = useRef(false)

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event)
    if (event.defaultPrevented || event.button !== 0) return

    const rail = event.currentTarget
    const startX = event.clientX
    let lastDelta = 0
    let committed = false
    let started = false
    draggedRef.current = false
    rail.setPointerCapture(event.pointerId)

    const move = (pointer: PointerEvent) => {
      const delta = (pointer.clientX - startX) * (side === "right" ? -1 : 1)
      lastDelta = delta
      if (Math.abs(delta) < 3) return
      if (!started) {
        started = true
        onRailDragStart?.(rail)
      }
      draggedRef.current = true
      onDragChange?.(delta)
      if (onDragChange || Math.abs(delta) < 24) return
      if (!committed) {
        committed = true
        onCollapsedChange(delta <= 0)
      }
    }
    const finish = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId)
      onDragEnd?.(lastDelta, draggedRef.current)
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
  }, [onCollapsedChange, onDragChange, onDragEnd, onPointerDown, onRailDragStart, side])

  if (closeOnly && collapsed) return null

  return <button
    type="button"
    aria-label={label}
    title={label}
    tabIndex={-1}
    data-collapsed={collapsed}
    onPointerDown={beginDrag}
    onClick={(event) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      if (draggedRef.current) {
        draggedRef.current = false
        event.preventDefault()
        return
      }
      if (activation === "click") onCollapsedChange(!collapsed)
    }}
    onDoubleClick={(event) => {
      onDoubleClick?.(event)
      if (!event.defaultPrevented && activation === "double-click") onCollapsedChange(!collapsed)
    }}
    className={cn("touch-none select-none", className)}
    {...props}
  />
}
