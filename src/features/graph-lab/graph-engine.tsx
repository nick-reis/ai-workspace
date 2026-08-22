import FocusIcon from "@hugeicons/core-free-icons/FocusIcon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshCwIcon";
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";

import { makeInitialPositions } from "./layout";
import { createGraphRenderer } from "./renderer";
import type { Camera, GraphData, GraphRenderer } from "./types";

type PhysicsMessage = { type: "positions"; buffer: ArrayBuffer; energy: number };
type PhysicsSettings = {
  centerForce: number;
  repelForce: number;
  linkForce: number;
  linkDistance: number;
};

const DEFAULT_PHYSICS_SETTINGS: PhysicsSettings = {
  centerForce: 0.08,
  repelForce: 34,
  linkForce: 0.45,
  linkDistance: 72,
};

const DEFAULT_FIT_SCALE_FACTOR = 0.58;
const MINIMUM_CAMERA_SCALE = 0.04;
const LABEL_FADE_START_SCALE = 1.35;
const LABEL_FADE_END_SCALE = 2.2;

function PhysicsControl({
  label,
  description,
  value,
  valueLabel,
  minimum,
  maximum,
  step,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  valueLabel: string;
  minimum: number;
  maximum: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-4 text-xs font-medium text-foreground">
        <span>{label}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{valueLabel}</span>
      </span>
      <input
        type="range"
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
        min={minimum}
        max={maximum}
        step={step}
        value={value}
        aria-label={label}
        title={description}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{description}</span>
    </label>
  );
}

function fitText(context: CanvasRenderingContext2D, text: string, maximumWidth: number) {
  if (context.measureText(text).width <= maximumWidth) return text;
  let low = 1;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${text.slice(0, middle)}…`).width <= maximumWidth) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(minimum: number, maximum: number, value: number) {
  const progress = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

export function GraphEngine({ data }: { data: GraphData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const positionsRef = useRef(makeInitialPositions(data.nodes.length));
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const sizeRef = useRef({ width: 1, height: 1, ratio: 1 });
  const frameRef = useRef<number | null>(null);
  const hoverRef = useRef(-1);
  const selectedRef = useRef(-1);
  const pointerRef = useRef<{ mode: "pan" | "drag"; index: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const dragTargetRef = useRef<{ index: number; x: number; y: number } | null>(null);
  const pinFrameRef = useRef<number | null>(null);
  const messageCountRef = useRef(0);
  const [rendererKind, setRendererKind] = useState("Starting…");
  const [isReady, setIsReady] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [energy, setEnergy] = useState(0);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [physicsSettings, setPhysicsSettings] = useState(DEFAULT_PHYSICS_SETTINGS);
  const physicsSettingsRef = useRef(DEFAULT_PHYSICS_SETTINGS);
  const themeColorsRef = useRef({ background: "#17171a", foreground: "#fafafa", mutedForeground: "#a1a1aa", border: "#27272a" });
  const nodeIndex = useMemo(() => new Map(data.nodes.map((node, index) => [node.id, index])), [data.nodes]);
  const initialPositions = useMemo(() => makeInitialPositions(data.nodes.length), [data.nodes.length]);
  const relationshipLegend = useMemo(() => Array.from(
    new Map(data.edges
      .filter((edge) => edge.relationshipType)
      .map((edge) => [edge.relationshipType as string, edge.color ?? "#94a3b8"])),
  ).sort(([left], [right]) => left.localeCompare(right)), [data.edges]);

  const updatePhysicsSetting = useCallback((setting: keyof PhysicsSettings, value: number) => {
    const nextSettings = { ...physicsSettingsRef.current, [setting]: value };
    physicsSettingsRef.current = nextSettings;
    setPhysicsSettings(nextSettings);
    workerRef.current?.postMessage({ type: "configure", settings: nextSettings });
  }, []);

  const drawLabels = useCallback(() => {
    const canvas = labelCanvasRef.current;
    if (!canvas) return;
    const { width, height, ratio } = sizeRef.current;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const positions = positionsRef.current;
    const camera = cameraRef.current;
    const normalOpacity = smoothstep(LABEL_FADE_START_SCALE, LABEL_FADE_END_SCALE, camera.scale);
    context.textBaseline = "middle";
    context.lineJoin = "round";
    const interactiveIndices = [selectedRef.current, hoverRef.current]
      .filter((index, position, indices) => index >= 0 && indices.indexOf(index) === position);
    const visibleIndices = [
      ...data.nodes.map((_, index) => index).filter((index) => !interactiveIndices.includes(index)),
      ...interactiveIndices,
    ];
    for (const index of visibleIndices) {
      const interactive = index === hoverRef.current || index === selectedRef.current;
      const opacity = interactive ? 1 : normalOpacity;
      if (opacity <= 0.01) continue;
      const screenX = positions[index * 2] * camera.scale + camera.x;
      const screenY = positions[index * 2 + 1] * camera.scale + camera.y;
      if (screenX < -80 || screenX > width + 80 || screenY < -20 || screenY > height + 20) continue;
      const radius = Math.max(3, (data.nodes[index].radius ?? 7) * camera.scale);
      context.font = interactive
        ? "600 12px Inter, ui-sans-serif, system-ui, sans-serif"
        : "500 11px Inter, ui-sans-serif, system-ui, sans-serif";
      const textHeight = interactive ? 14 : 13;
      const label = fitText(context, data.nodes[index].label, interactive ? 320 : 200);
      const textWidth = context.measureText(label).width;
      const placement = { x: screenX - textWidth / 2, y: screenY + radius + 9 + textHeight / 2 };
      const box = { x: placement.x - 4, y: placement.y - textHeight / 2 - 3, width: textWidth + 8, height: textHeight + 6 };
      if (box.x + box.width < 4 || box.x > width - 4 || box.y + box.height < 4 || box.y > height - 4) continue;
      context.globalAlpha = opacity;
      context.beginPath();
      context.roundRect(box.x, box.y, box.width, box.height, 4);
      context.fillStyle = themeColorsRef.current.background;
      context.fill();
      context.strokeStyle = interactive ? (data.nodes[index].color ?? themeColorsRef.current.border) : themeColorsRef.current.border;
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = interactive ? themeColorsRef.current.foreground : themeColorsRef.current.mutedForeground;
      context.fillText(label, placement.x, placement.y);
    }
    context.globalAlpha = 1;
  }, [data.nodes]);

  const draw = useCallback(() => {
    frameRef.current = null;
    rendererRef.current?.render(positionsRef.current, cameraRef.current);
    drawLabels();
  }, [drawLabels]);

  const requestDraw = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const fitGraph = useCallback(() => {
    const positions = positionsRef.current;
    if (!positions.length) return;
    let left = positions[0];
    let right = positions[0];
    let top = positions[1];
    let bottom = positions[1];
    for (let index = 1; index < data.nodes.length; index += 1) {
      left = Math.min(left, positions[index * 2]);
      right = Math.max(right, positions[index * 2]);
      top = Math.min(top, positions[index * 2 + 1]);
      bottom = Math.max(bottom, positions[index * 2 + 1]);
    }
    const { width, height } = sizeRef.current;
    const fittedScale = Math.min((width - 120) / Math.max(1, right - left), (height - 120) / Math.max(1, bottom - top));
    const scale = clamp(fittedScale * DEFAULT_FIT_SCALE_FACTOR, MINIMUM_CAMERA_SCALE, 2.2);
    cameraRef.current = {
      scale,
      x: width / 2 - ((left + right) / 2) * scale,
      y: height / 2 - ((top + bottom) / 2) * scale,
    };
    requestDraw();
  }, [data.nodes.length, requestDraw]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const labelCanvas = labelCanvasRef.current;
    if (!container || !canvas || !labelCanvas) return;
    positionsRef.current = initialPositions.slice();
    messageCountRef.current = 0;
    setIsReady(false);
    cameraRef.current = { x: 0, y: 0, scale: 1 };
    selectedRef.current = -1;
    hoverRef.current = -1;
    setSelectedIndex(-1);
    const rootStyles = getComputedStyle(document.documentElement);
    const cssColor = (name: string, fallback: string) => rootStyles.getPropertyValue(name).trim() || fallback;
    themeColorsRef.current = {
      background: cssColor("--background", "#17171a"),
      foreground: cssColor("--foreground", "#fafafa"),
      mutedForeground: cssColor("--muted-foreground", "#a1a1aa"),
      border: cssColor("--border", "#27272a"),
    };
    const renderer = createGraphRenderer(canvas, data, nodeIndex, themeColorsRef.current.background);
    rendererRef.current = renderer;
    setRendererKind(renderer.kind);

    let hasInitialFit = false;
    const resize = () => {
      const bounds = container.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { width, height, ratio };
      renderer.resize(width, height, ratio);
      labelCanvas.width = Math.round(width * ratio);
      labelCanvas.height = Math.round(height * ratio);
      labelCanvas.style.width = `${width}px`;
      labelCanvas.style.height = `${height}px`;
      if (!hasInitialFit) {
        hasInitialFit = true;
        fitGraph();
      } else {
        requestDraw();
      }
    };
    resize();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    resizeObserver?.observe(container);
    if (!resizeObserver) window.addEventListener("resize", resize);

    const edgeIndices = new Uint32Array(data.edges.length * 2);
    data.edges.forEach((edge, index) => {
      edgeIndices[index * 2] = nodeIndex.get(edge.source) ?? 0;
      edgeIndices[index * 2 + 1] = nodeIndex.get(edge.target) ?? 0;
    });

    let worker: Worker | null = null;
    if (typeof Worker !== "undefined") {
      worker = new Worker(new URL("./physics.worker.ts", import.meta.url), { type: "module", name: "graph-lab-physics" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<PhysicsMessage>) => {
        if (event.data.type !== "positions") return;
        const isFirstSnapshot = messageCountRef.current === 0;
        const previous = positionsRef.current;
        const incomingPositions = new Float32Array(event.data.buffer);
        const dragTarget = dragTargetRef.current;
        if (dragTarget) {
          incomingPositions[dragTarget.index * 2] = dragTarget.x;
          incomingPositions[dragTarget.index * 2 + 1] = dragTarget.y;
        }
        positionsRef.current = incomingPositions;
        if (previous.buffer.byteLength > 0) {
          worker?.postMessage({ type: "recycle", buffer: previous.buffer }, [previous.buffer]);
        }
        messageCountRef.current += 1;
        if (messageCountRef.current % 6 === 0 || event.data.energy < 0.003) setEnergy(event.data.energy);
        if (isFirstSnapshot) {
          fitGraph();
          setIsReady(true);
        } else {
          requestDraw();
        }
      };
      const workerPositions = initialPositions.slice();
      worker.postMessage({
        type: "init",
        positions: workerPositions.buffer,
        edges: edgeIndices.buffer,
        nodeCount: data.nodes.length,
        settings: physicsSettingsRef.current,
      }, [workerPositions.buffer, edgeIndices.buffer]);
    } else {
      fitGraph();
      setIsReady(true);
    }

    const handleContextLost = (event: Event) => event.preventDefault();
    const handleContextRestored = () => {
      rendererRef.current?.destroy();
      rendererRef.current = createGraphRenderer(canvas, data, nodeIndex, themeColorsRef.current.background);
      setRendererKind(rendererRef.current.kind);
      resize();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    return () => {
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", resize);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      worker?.terminate();
      workerRef.current = null;
      if (pinFrameRef.current !== null) cancelAnimationFrame(pinFrameRef.current);
      pinFrameRef.current = null;
      dragTargetRef.current = null;
      rendererRef.current?.destroy();
      rendererRef.current = null;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [data, fitGraph, initialPositions, nodeIndex, requestDraw]);

  const localPoint = (clientX: number, clientY: number) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (bounds?.left ?? 0), y: clientY - (bounds?.top ?? 0) };
  };

  const pickNode = (screenX: number, screenY: number) => {
    const positions = positionsRef.current;
    const camera = cameraRef.current;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < data.nodes.length; index += 1) {
      const dx = positions[index * 2] * camera.scale + camera.x - screenX;
      const dy = positions[index * 2 + 1] * camera.scale + camera.y - screenY;
      const distance = dx * dx + dy * dy;
      const hitRadius = Math.max(10, (data.nodes[index].radius ?? 7) * camera.scale + 5);
      if (distance <= hitRadius * hitRadius && distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }
    return bestIndex;
  };

  const worldPoint = (screenX: number, screenY: number) => ({
    x: (screenX - cameraRef.current.x) / cameraRef.current.scale,
    y: (screenY - cameraRef.current.y) / cameraRef.current.scale,
  });

  const updateDraggedNode = (index: number, x: number, y: number) => {
    dragTargetRef.current = { index, x, y };
    positionsRef.current[index * 2] = x;
    positionsRef.current[index * 2 + 1] = y;
    if (workerRef.current && pinFrameRef.current === null) {
      pinFrameRef.current = requestAnimationFrame(() => {
        pinFrameRef.current = null;
        const target = dragTargetRef.current;
        if (target) workerRef.current?.postMessage({ type: "pin", ...target, fixed: true });
      });
    }
    requestDraw();
  };

  const releaseDraggedNode = () => {
    if (pinFrameRef.current !== null) cancelAnimationFrame(pinFrameRef.current);
    pinFrameRef.current = null;
    const target = dragTargetRef.current;
    if (target) workerRef.current?.postMessage({ type: "pin", ...target, fixed: false });
    dragTargetRef.current = null;
  };

  return (
    <div ref={containerRef} className="relative h-full min-h-[460px] w-full touch-none overflow-hidden bg-background">
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 size-full transition-opacity duration-200 ${isReady ? "opacity-100" : "opacity-0"}`}
        aria-label={`Interactive graph with ${data.nodes.length} nodes and ${data.edges.length} edges`}
        onPointerDown={(event) => {
          const point = localPoint(event.clientX, event.clientY);
          const index = pickNode(point.x, point.y);
          event.currentTarget.setPointerCapture(event.pointerId);
          if (index >= 0) {
            const world = worldPoint(point.x, point.y);
            const offsetX = positionsRef.current[index * 2] - world.x;
            const offsetY = positionsRef.current[index * 2 + 1] - world.y;
            pointerRef.current = { mode: "drag", index, x: point.x, y: point.y, offsetX, offsetY };
            selectedRef.current = index;
            setSelectedIndex(index);
            updateDraggedNode(index, world.x + offsetX, world.y + offsetY);
          } else {
            selectedRef.current = -1;
            setSelectedIndex(-1);
            pointerRef.current = { mode: "pan", index: -1, x: point.x, y: point.y, offsetX: 0, offsetY: 0 };
          }
          requestDraw();
        }}
        onPointerMove={(event) => {
          const point = localPoint(event.clientX, event.clientY);
          const pointer = pointerRef.current;
          if (pointer?.mode === "pan") {
            cameraRef.current.x += point.x - pointer.x;
            cameraRef.current.y += point.y - pointer.y;
            pointer.x = point.x;
            pointer.y = point.y;
          } else if (pointer?.mode === "drag") {
            const world = worldPoint(point.x, point.y);
            updateDraggedNode(pointer.index, world.x + pointer.offsetX, world.y + pointer.offsetY);
          } else {
            hoverRef.current = pickNode(point.x, point.y);
          }
          requestDraw();
        }}
        onPointerUp={(event) => {
          const pointer = pointerRef.current;
          if (pointer?.mode === "drag") {
            const point = localPoint(event.clientX, event.clientY);
            const world = worldPoint(point.x, point.y);
            updateDraggedNode(pointer.index, world.x + pointer.offsetX, world.y + pointer.offsetY);
            releaseDraggedNode();
          }
          pointerRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          if (pointerRef.current?.mode === "drag") releaseDraggedNode();
          pointerRef.current = null;
        }}
        onWheel={(event) => {
          event.preventDefault();
          const point = localPoint(event.clientX, event.clientY);
          const before = worldPoint(point.x, point.y);
          cameraRef.current.scale = clamp(cameraRef.current.scale * Math.exp(-event.deltaY * 0.001), MINIMUM_CAMERA_SCALE, 4);
          cameraRef.current.x = point.x - before.x * cameraRef.current.scale;
          cameraRef.current.y = point.y - before.y * cameraRef.current.scale;
          requestDraw();
        }}
      />
      <canvas ref={labelCanvasRef} className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${isReady ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />

      {!isReady ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          <span className="flex items-center gap-2"><Icon icon={Loading03Icon} className="size-4 animate-spin" /> Arranging graph…</span>
        </div>
      ) : null}

      <div className="absolute right-4 top-4 flex gap-2">
        <button type="button" className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background/85 px-3 text-sm font-medium text-foreground backdrop-blur hover:bg-muted" onClick={fitGraph}>
          <Icon icon={FocusIcon} className="size-4" /> Fit
        </button>
        <button type="button" className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background/85 px-3 text-sm font-medium text-foreground backdrop-blur hover:bg-muted" onClick={() => workerRef.current?.postMessage({ type: "restart" })}>
          <Icon icon={RefreshCwIcon} className="size-4" /> Reheat
        </button>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background/85 text-foreground backdrop-blur hover:bg-muted"
          aria-label="Toggle graph controls"
          aria-expanded={controlsOpen}
          onClick={() => setControlsOpen((open) => !open)}
        >
          <Icon icon={SlidersHorizontalIcon} className="size-4" />
        </button>
      </div>

      {controlsOpen ? (
        <aside className="absolute right-4 top-14 z-10 w-72 rounded-lg border border-border bg-background/95 p-4 shadow-lg backdrop-blur">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-foreground">Forces</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Tune the graph layout in real time.</p>
          </div>
          <div className="space-y-4">
            <PhysicsControl
              label="Center force"
              description="Pulls the overall cluster toward the middle."
              value={physicsSettings.centerForce}
              valueLabel={physicsSettings.centerForce.toFixed(3)}
              minimum={0}
              maximum={0.2}
              step={0.005}
              onChange={(value) => updatePhysicsSetting("centerForce", value)}
            />
            <PhysicsControl
              label="Repel force"
              description="Pushes nodes apart to reduce crowding."
              value={physicsSettings.repelForce}
              valueLabel={physicsSettings.repelForce.toFixed(0)}
              minimum={0}
              maximum={100}
              step={1}
              onChange={(value) => updatePhysicsSetting("repelForce", value)}
            />
            <PhysicsControl
              label="Link force"
              description="Controls the tension between connected nodes."
              value={physicsSettings.linkForce}
              valueLabel={physicsSettings.linkForce.toFixed(2)}
              minimum={0}
              maximum={1}
              step={0.01}
              onChange={(value) => updatePhysicsSetting("linkForce", value)}
            />
            <PhysicsControl
              label="Link distance"
              description="Sets the baseline length of connection lines."
              value={physicsSettings.linkDistance}
              valueLabel={`${physicsSettings.linkDistance.toFixed(0)} px`}
              minimum={24}
              maximum={200}
              step={2}
              onChange={(value) => updatePhysicsSetting("linkDistance", value)}
            />
          </div>
        </aside>
      ) : null}

      <div className="pointer-events-none absolute bottom-4 left-4 max-w-[min(36rem,calc(100%-2rem))] rounded-lg border border-border bg-background/85 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-foreground">{rendererKind}</span>
          <span>{data.nodes.length} nodes</span>
          <span>{data.edges.length} edges</span>
          <span>energy {energy.toFixed(4)}</span>
        </div>
        {relationshipLegend.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2">
            {relationshipLegend.map(([relationshipType, color]) => (
              <span key={relationshipType} className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
                {relationshipType.replaceAll("_", " ")}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {selectedIndex >= 0 ? (
        <div className="pointer-events-none absolute bottom-4 right-4 max-w-56 rounded-lg border border-border bg-background/90 p-3 text-xs text-muted-foreground backdrop-blur">
          <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
            <span className="size-2 rounded-full" style={{ backgroundColor: data.nodes[selectedIndex].color }} />
            {data.nodes[selectedIndex].label}
          </div>
          <p className="text-[10px] text-muted-foreground">Graph node · drag to reposition</p>
        </div>
      ) : null}
    </div>
  );
}
