import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import mermaid from "mermaid";
import type { ChartGraph } from "../lib/chart/types";
import { chartToMermaid } from "../lib/chart/mermaid";
import { useSettingsStore } from "../store/settingsStore";
import { useStreamingStore } from "../store/streamingStore";
import { Play, Square, ZoomIn, ZoomOut, Maximize } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────

interface Viewport { x: number; y: number; scale: number; }
interface ActiveNodeBounds { left: number; top: number; width: number; height: number; }

const MIN_SCALE      = 0.1;
const MAX_SCALE      = 4;
const ZOOM_SENSITIVITY = 0.0012;
const NODE_SHAPE_SELECTOR = "rect, polygon, circle, ellipse, path";

let uid = 0;

// ── SVG size from mermaid output ──────────────────────────────

function parseSvgSize(svgStr: string): { w: number; h: number } | null {
  const vb = svgStr.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
  if (vb) return { w: parseFloat(vb[1]), h: parseFloat(vb[2]) };
  const ew = svgStr.match(/\swidth="([\d.]+)"/);
  const eh = svgStr.match(/\sheight="([\d.]+)"/);
  if (ew && eh) return { w: parseFloat(ew[1]), h: parseFloat(eh[1]) };
  return null;
}

// ── Mermaid render hook ───────────────────────────────────────

// chartToMermaid includes a custom `title:` line that our own parser understands
// but that mermaid.js rejects. Strip it (and any other custom-only lines) here.
function toMermaidJs(chart: ChartGraph): string {
  return chartToMermaid(chart)
    .split("\n")
    .filter((l) => !l.startsWith("title:"))
    .join("\n");
}

function useMermaidSvg(chart: ChartGraph | null, isDark: boolean, theme: string): string {
  const [svg, setSvg] = useState("");

  useEffect(() => {
    if (!chart) { setSvg(""); return; }
    let cancelled = false;

    // Debounce: wait 300ms of inactivity before calling mermaid.render.
    // During live streaming the chart updates every token; without this we'd
    // fire dozens of renders per second, most of which would fail on partial
    // Mermaid that's still being built.
    const timer = setTimeout(() => {
      const text = toMermaidJs(chart);
      const id   = `tf-mermaid-${++uid}`;

      const getVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: {
          background: getVar('--chart-bg'),
          primaryColor: getVar('--chart-node-bg'),
          primaryTextColor: getVar('--chart-text'),
          primaryBorderColor: getVar('--chart-node-border'),
          lineColor: getVar('--chart-edge'),
          secondaryColor: getVar('--chart-bg'),
          tertiaryColor: getVar('--chart-bg'),
          nodeTextColor: getVar('--chart-text'),
          fontFamily: "inherit",
        },
        themeCSS: `
          .node rect, .node polygon, .node circle, .node ellipse, .node path {
            fill: var(--chart-node-bg) !important;
            stroke: var(--chart-node-border) !important;
            stroke-width: 1.5px !important;
            transition: all 0.3s ease;
          }
          .node.node-active rect, .node.node-active polygon, .node.node-active circle, .node.node-active path {
            stroke: var(--ring) !important;
            stroke-width: 3px !important;
            stroke-dasharray: 5 2;
          }
          .node .label {
            color: var(--chart-text) !important;
          }
          .edgePath .path {
            stroke: var(--chart-edge) !important;
            stroke-width: 1.5px !important;
          }
          .edgeLabel {
            background-color: var(--chart-bg) !important;
            color: var(--chart-text) !important;
          }
          .marker {
            fill: var(--chart-edge) !important;
            stroke: var(--chart-edge) !important;
          }
        `,
        flowchart: { curve: "basis", padding: 20, htmlLabels: true },
        securityLevel: "loose",
      });

      mermaid.render(id, text)
        .then(({ svg: s }) => {
          if (!cancelled) {
            console.log(`[mermaid] rendered ${chart.nodes.length} nodes, ${chart.edges.length} edges`);
            setSvg(s);
          }
        })
        .catch((err) => {
          if (!cancelled) console.warn("[mermaid] render failed:", err, "\nInput:\n", text);
        });
    }, 300);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [chart, isDark, theme]);

  return svg;
}

// ── Fit helper ────────────────────────────────────────────────

function fitViewport(
  svgW: number, svgH: number,
  containerW: number, containerH: number,
  padding = 40
): Viewport {
  if (svgW === 0 || svgH === 0) return { x: padding, y: padding, scale: 1 };
  const scale = Math.min(
    (containerW - padding * 2) / svgW,
    (containerH - padding * 2) / svgH,
    1.2
  );
  return {
    scale,
    x: (containerW - svgW * scale) / 2,
    y: (containerH - svgH * scale) / 2,
  };
}

// ── Zoom at point ─────────────────────────────────────────────

function zoomAt(vp: Viewport, factor: number, el: HTMLElement | null): Viewport {
  if (!el) return vp;
  const rect     = el.getBoundingClientRect();
  const cx       = rect.width / 2;
  const cy       = rect.height / 2;
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vp.scale * factor));
  const f        = newScale / vp.scale;
  return { scale: newScale, x: cx - (cx - vp.x) * f, y: cy - (cy - vp.y) * f };
}

function mermaidNodeMatches(el: Element, nodeId: string): boolean {
  const id = el.id || "";
  if (id === nodeId) return true;

  // Mermaid flowchart nodes are commonly emitted as `flowchart-n1-0`.
  if (id.includes(`-${nodeId}-`) || id.endsWith(`-${nodeId}`) || id.startsWith(`${nodeId}-`)) {
    return true;
  }

  return Array.from(el.classList).some((cls) => cls === nodeId || cls.includes(`-${nodeId}-`));
}

function mermaidNodeCenter(el: Element): { x: number; y: number } | null {
  const transform = el.getAttribute("transform");
  const translated = transform?.match(/translate\(([-\d.]+)[,\s]+([-\d.]+)\)/);
  if (translated) {
    return { x: parseFloat(translated[1]), y: parseFloat(translated[2]) };
  }

  if ("getBBox" in el) {
    const bbox = (el as SVGGraphicsElement).getBBox();
    return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
  }

  return null;
}

function setMermaidNodeHighlight(el: Element, active: boolean) {
  el.classList.toggle("node-active", active);

  for (const shape of Array.from(el.querySelectorAll<SVGElement>(NODE_SHAPE_SELECTOR))) {
    if (active) {
      shape.style.setProperty("stroke", "var(--ring)", "important");
      shape.style.setProperty("stroke-width", "3px", "important");
      shape.style.setProperty("stroke-dasharray", "5 2", "important");
    } else {
      shape.style.removeProperty("stroke");
      shape.style.removeProperty("stroke-width");
      shape.style.removeProperty("stroke-dasharray");
    }
  }
}

function findMermaidNode(container: HTMLElement, nodeId: string): Element | null {
  const nodes = container.querySelectorAll(".node");
  return Array.from(nodes).find((n) => mermaidNodeMatches(n, nodeId)) ?? null;
}

// ── Component ─────────────────────────────────────────────────

interface MermaidRendererProps {
  chart: ChartGraph | null;
}

export function MermaidRenderer({ chart }: MermaidRendererProps) {
  const { theme, colorMode } = useSettingsStore();
  const isDark = colorMode === "dark";
  const { isStreaming } = useStreamingStore();

  const svg = useMermaidSvg(chart, isDark, theme);

  const containerRef = useRef<HTMLDivElement>(null);
  const [vp, setVp]  = useState<Viewport>({ x: 40, y: 40, scale: 1 });
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [activeBounds, setActiveBounds] = useState<ActiveNodeBounds | null>(null);
  const vpRef        = useRef(vp);
  vpRef.current = vp;

  const size = useMemo(() => parseSvgSize(svg), [svg]);

  // Follow latest content during streaming; fit-to-view when done.
  useEffect(() => {
    if (!svg || !containerRef.current || !size) return;
    const rect = containerRef.current.getBoundingClientRect();

    if (isStreaming) {
      let targetX = size.w / 2;
      let targetY = size.h;

      // Find the bottom-most node to follow its exact coordinates
      const nodes = containerRef.current.querySelectorAll(".node");
      if (nodes.length > 0) {
        let maxY = -Infinity;
        for (const node of Array.from(nodes)) {
          const transform = node.getAttribute("transform");
          if (transform) {
            const match = transform.match(/translate\(([\d.-]+)[,\s]+([\d.-]+)\)/);
            if (match) {
              const nx = parseFloat(match[1]);
              const ny = parseFloat(match[2]);
              if (ny > maxY) {
                maxY = ny;
                targetX = nx;
              }
            }
          }
        }
        if (maxY !== -Infinity) {
          targetY = maxY;
        }
      }

      // Scroll to the latest node at a comfortable zoom
      const scale = 0.75;
      setVp({
        scale,
        x: rect.width / 2 - targetX * scale,
        y: rect.height * 0.65 - targetY * scale,
      });
    } else if (!activeNodeId) {
      setVp(fitViewport(size.w, size.h, rect.width, rect.height));
      console.log(`[mermaid] fit-to-view — svg ${size.w.toFixed(0)}×${size.h.toFixed(0)}`);
    }
  }, [svg, isStreaming, activeNodeId]);

  // ── Highlighting & Center Active Node ───────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    
    const nodes = containerRef.current.querySelectorAll(".node");
    let targetNode: Element | null = null;

    for (const n of Array.from(nodes)) {
      const isActive = !!activeNodeId && mermaidNodeMatches(n, activeNodeId);
      setMermaidNodeHighlight(n, isActive);
      if (isActive) {
        targetNode = n;
      }
    }

    if (!targetNode) {
      setActiveBounds(null);
      return;
    }

    const center = mermaidNodeCenter(targetNode);
    if (!center) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scale = Math.max(vp.scale, 1.1);
    setVp({
      scale,
      x: rect.width / 2 - center.x * scale,
      y: rect.height / 2 - center.y * scale,
    });
  }, [activeNodeId, svg]);

  useEffect(() => {
    if (!containerRef.current || !activeNodeId) {
      setActiveBounds(null);
      return;
    }

    const targetNode = findMermaidNode(containerRef.current, activeNodeId);
    if (!targetNode) {
      setActiveBounds(null);
      return;
    }

    const nodeRect = targetNode.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    const pad = 8;
    setActiveBounds({
      left: nodeRect.left - containerRect.left - pad,
      top: nodeRect.top - containerRect.top - pad,
      width: nodeRect.width + pad * 2,
      height: nodeRect.height + pad * 2,
    });
  }, [activeNodeId, svg, vp]);

  // ── KB Navigation ───────────────────────────────────────────

  useEffect(() => {
    if (!activeNodeId || !chart) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Find parent (incoming edge)
      const incoming = chart.edges.filter(ev => ev.to === activeNodeId);
      const parentId = incoming.length > 0 ? incoming[0].from : null;
      
      // Find siblings (all children of my parent)
      const siblings = parentId 
        ? chart.edges.filter(ev => ev.from === parentId).map(ev => ev.to)
        : [];
      
      const outgoing = chart.edges.filter(ev => ev.from === activeNodeId);

      if (e.key === "ArrowDown" || e.key === "Enter") {
        if (outgoing.length > 0) setActiveNodeId(outgoing[0].to);
      } else if (e.key === "ArrowUp" || e.key === "Backspace") {
        if (parentId) setActiveNodeId(parentId);
      } else if (e.key === "ArrowRight") {
        const idx = siblings.indexOf(activeNodeId);
        if (idx !== -1 && idx < siblings.length - 1) setActiveNodeId(siblings[idx + 1]);
      } else if (e.key === "ArrowLeft") {
        const idx = siblings.indexOf(activeNodeId);
        if (idx > 0) setActiveNodeId(siblings[idx - 1]);
      } else if (e.key === "Escape") {
        setActiveNodeId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeNodeId, chart]);

  const startNavigation = () => {
    if (!chart || chart.nodes.length === 0) return;
    const startNode = chart.nodes.find(n => n.id === "n1") || chart.nodes[0];
    setActiveNodeId(startNode.id);
  };

  // ── Pan ────────────────────────────────────────────────────

  const isPanning = useRef(false);
  const panStart  = useRef({ x: 0, y: 0, vpX: 0, vpY: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Don't start panning if clicking on the control buttons
    if ((e.target as HTMLElement).closest('button')) return;
    
    isPanning.current = true;
    panStart.current  = { x: e.clientX, y: e.clientY, vpX: vpRef.current.x, vpY: vpRef.current.y };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = "grabbing";
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setVp((v) => ({ ...v, x: panStart.current.vpX + dx, y: panStart.current.vpY + dy }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isPanning.current = false;
    e.currentTarget.style.cursor = "grab";
  }, []);

  // ── Zoom ───────────────────────────────────────────────────

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect  = containerRef.current!.getBoundingClientRect();
    const cx    = e.clientX - rect.left;
    const cy    = e.clientY - rect.top;
    const delta = -e.deltaY * ZOOM_SENSITIVITY;
    setVp((v) => {
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * (1 + delta)));
      const factor   = newScale / v.scale;
      return { scale: newScale, x: cx - (cx - v.x) * factor, y: cy - (cy - v.y) * factor };
    });
  }, []);

  const fitView = useCallback(() => {
    if (!svg || !containerRef.current || !size) return;
    const rect = containerRef.current.getBoundingClientRect();
    setVp(fitViewport(size.w, size.h, rect.width, rect.height));
  }, [svg, size]);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-chart-bg select-none"
      style={{ cursor: "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
    >
      {svg && size && (
        <div
          style={{
            position: "absolute",
            transformOrigin: "0 0",
            transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`,
            width: `${size.w}px`,
            height: `${size.h}px`,
          }}
          // mermaid's SVG uses inline styles; override background so it respects our canvas
          className="[&_svg]:w-full [&_svg]:h-full [&_svg]:bg-transparent [&_svg]:max-w-none"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}

      {activeBounds && (
        <svg
          className="absolute pointer-events-none overflow-visible"
          style={{
            left: `${activeBounds.left}px`,
            top: `${activeBounds.top}px`,
            width: `${activeBounds.width}px`,
            height: `${activeBounds.height}px`,
          }}
        >
          <rect
            x={1.25}
            y={1.25}
            width={Math.max(0, activeBounds.width - 2.5)}
            height={Math.max(0, activeBounds.height - 2.5)}
            rx={10}
            fill="none"
            stroke="var(--ring)"
            strokeWidth={2.5}
            strokeDasharray="6 4"
          />
        </svg>
      )}

      {!chart && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-[13px] pointer-events-none">
          Send a message to generate a diagram
        </div>
      )}

      {chart && (
        <div className="absolute bottom-3 right-3 flex gap-1">
          <ControlBtn 
            onClick={activeNodeId ? () => setActiveNodeId(null) : startNavigation} 
            title={activeNodeId ? "Stop Playback" : "Start Playback (Arrow keys to navigate)"}
          >
            {activeNodeId ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </ControlBtn>
          <ControlBtn onClick={() => setVp((v) => zoomAt(v, 1.25, containerRef.current))}>
            <ZoomIn size={14} />
          </ControlBtn>
          <ControlBtn onClick={() => setVp((v) => zoomAt(v, 0.8,  containerRef.current))}>
            <ZoomOut size={14} />
          </ControlBtn>
          <ControlBtn onClick={fitView}>
            <Maximize size={14} />
          </ControlBtn>
        </div>
      )}
    </div>
  );
}

// ── Control button ────────────────────────────────────────────

function ControlBtn({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 flex items-center justify-center rounded bg-primary border border-border text-muted-foreground hover:text-foreground hover:bg-secondary text-[14px] leading-none cursor-default"
    >
      {children}
    </button>
  );
}
