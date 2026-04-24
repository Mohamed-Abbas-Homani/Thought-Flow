import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Clipboard, Download, Play, Square, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import mermaid from "mermaid";
import type { ChartGraph } from "../lib/chart/types";
import { chartToClipboardMermaid, chartToMermaid } from "../lib/chart/mermaid";
import { exportDiagram, type ExportFormat } from "../lib/exportDiagram";
import { useSettingsStore } from "../store/settingsStore";
import { useStreamingStore } from "../store/streamingStore";

// ── Types ──────────────────────────────────────────────────────

interface Viewport { x: number; y: number; scale: number; }
interface ActiveNodeBounds { left: number; top: number; width: number; height: number; }

const MIN_SCALE      = 0.1;
const MAX_SCALE      = 4;
const ZOOM_SENSITIVITY = 0.0012;
const NODE_SHAPE_SELECTOR = "rect, polygon, circle, ellipse, path";

let uid = 0;

function clipboardThemeTokens() {
  const styles = getComputedStyle(document.documentElement);
  const get = (name: string) => styles.getPropertyValue(name).trim();
  return {
    chartBg: get("--chart-bg"),
    chartNodeBg: get("--chart-node-bg"),
    chartNodeBorder: get("--chart-node-border"),
    chartEdge: get("--chart-edge"),
    chartText: get("--chart-text"),
  };
}

// ── SVG size from mermaid output ──────────────────────────────

function parseSvgSize(svgStr: string): { w: number; h: number } | null {
  const vb = svgStr.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/);
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
            stroke: var(--chart-node-bg) !important;
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
      shape.style.setProperty("stroke", "var(--chart-text)", "important");
      shape.style.setProperty("stroke-width", "3.5px", "important");
      shape.style.setProperty("stroke-dasharray", "6 3", "important");
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
  onRenameNode?: (nodeId: string, newText: string) => void;
  onRenameEdge?: (from: string, to: string, currentLabel: string, newLabel: string) => void;
  onRenameTitle?: (newTitle: string) => void;
}

type EditingState =
  | { kind: "node"; nodeId: string; text: string; left: number; top: number; width: number; height: number }
  | { kind: "edge"; from: string; to: string; currentLabel: string; text: string; left: number; top: number; width: number; height: number }
  | { kind: "title"; text: string; left: number; top: number; width: number; height: number };

export function MermaidRenderer({ chart, onRenameNode, onRenameEdge, onRenameTitle }: MermaidRendererProps) {
  const { theme, colorMode } = useSettingsStore();
  const isDark = colorMode === "dark";
  const { isStreaming } = useStreamingStore();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [editingState, setEditingState] = useState<EditingState | null>(null);

  const svg = useMermaidSvg(chart, isDark, theme);

  const containerRef = useRef<HTMLDivElement>(null);
  const [vp, setVp]  = useState<Viewport>({ x: 40, y: 40, scale: 1 });
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [activeBounds, setActiveBounds] = useState<ActiveNodeBounds | null>(null);
  const vpRef        = useRef(vp);
  vpRef.current = vp;

  const size = useMemo(() => parseSvgSize(svg), [svg]);

  // Compute the title's position in div-local coords (1 unit = 1 CSS pixel in the SVG div).
  // Done via live DOM query so getBBox() works; updated whenever the SVG re-renders.
  const [titleInfo, setTitleInfo] = useState<{ divX: number; divY: number } | null>(null);
  useEffect(() => {
    if (!svg || !chart || !containerRef.current) { setTitleInfo(null); return; }
    const title = chart.meta?.title;
    if (!title || title === "Untitled") { setTitleInfo(null); return; }

    const svgEl = containerRef.current.querySelector("svg");
    if (!svgEl) { setTitleInfo(null); return; }

    const vbMatch = svg.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)"/);
    const vbX = vbMatch ? parseFloat(vbMatch[1]) : 0;
    const vbY = vbMatch ? parseFloat(vbMatch[2]) : 0;

    const startNodeId = chart.nodes.find((n) => n.type === "start")?.id ?? chart.nodes[0]?.id ?? "";
    for (const el of Array.from(svgEl.querySelectorAll<SVGGElement>(".node"))) {
      if (!mermaidNodeMatches(el, startNodeId)) continue;
      const m = el.getAttribute("transform")?.match(/translate\(([-\d.]+)[,\s]+([-\d.]+)\)/);
      if (!m) break;
      const nx = parseFloat(m[1]);
      const ny = parseFloat(m[2]);
      let nodeHeight = 34;
      try { nodeHeight = el.getBBox().height; } catch { /* not rendered yet */ }
      // div-local coords = SVG user coords − viewBox origin (div is sized = viewBox dimensions)
      setTitleInfo({ divX: nx - vbX, divY: ny - nodeHeight / 2 - 24 - vbY });
      return;
    }
    setTitleInfo(null);
  }, [svg, chart]);

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

  // ── Node double-click to rename ────────────────────────────

  function commitMermaidEdit() {
    if (!editingState) return;
    const trimmed = editingState.text.trim();
    if (editingState.kind === "node") {
      if (trimmed) onRenameNode?.(editingState.nodeId, trimmed);
    } else if (editingState.kind === "edge") {
      onRenameEdge?.(editingState.from, editingState.to, editingState.currentLabel, trimmed);
    } else {
      if (trimmed) onRenameTitle?.(trimmed);
    }
    setEditingState(null);
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container || (!onRenameNode && !onRenameEdge && !onRenameTitle)) return;

    function handleDblClick(e: MouseEvent) {
      const target = e.target as Element;
      const containerRect = container!.getBoundingClientRect();

      const nodeEl = target.closest(".node");
      if (nodeEl && chart && onRenameNode) {
        const chartNode = chart.nodes.find((n) => mermaidNodeMatches(nodeEl, n.id));
        if (!chartNode) return;
        const nodeRect = nodeEl.getBoundingClientRect();
        setEditingState({ kind: "node", nodeId: chartNode.id, text: chartNode.text, left: nodeRect.left - containerRect.left, top: nodeRect.top - containerRect.top, width: nodeRect.width, height: nodeRect.height });
        e.preventDefault();
        return;
      }

      const edgeLabelEl = target.closest(".edgeLabel");
      if (edgeLabelEl && chart && onRenameEdge) {
        const labelText = (edgeLabelEl.textContent ?? "").trim();
        const chartEdge = chart.edges.find((e) => e.label && e.label.trim() === labelText);
        if (!chartEdge || !chartEdge.label) return;
        const elRect = edgeLabelEl.getBoundingClientRect();
        setEditingState({ kind: "edge", from: chartEdge.from, to: chartEdge.to, currentLabel: chartEdge.label, text: chartEdge.label, left: elRect.left - containerRect.left, top: elRect.top - containerRect.top, width: Math.max(elRect.width, 80), height: Math.max(elRect.height, 26) });
        e.preventDefault();
      }
    }

    container.addEventListener("dblclick", handleDblClick);
    return () => container.removeEventListener("dblclick", handleDblClick);
  }, [chart, svg, onRenameNode, onRenameEdge]);

  // ── Pan ────────────────────────────────────────────────────

  const isPanning = useRef(false);
  const panStart  = useRef({ x: 0, y: 0, vpX: 0, vpY: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (editingState) { setEditingState(null); return; }
    // Don't start panning if clicking on the control buttons
    if ((e.target as HTMLElement).closest('button')) return;
    // Don't start panning when clicking on a node, edge label, or chart title
    if ((e.target as Element).closest('.node')) return;
    if ((e.target as Element).closest('.edgeLabel')) return;
    if ((e.target as Element).closest('[data-chart-title]')) return;
    
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

  const copyMermaid = useCallback(async () => {
    if (!chart) return;
    try {
      await writeText(chartToClipboardMermaid(chart, clipboardThemeTokens()));
      setCopyState("copied");
    } catch (err) {
      console.warn("[clipboard] failed to copy Mermaid from mermaid renderer:", err);
      setCopyState("error");
    }
  }, [chart]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleExport = useCallback(async (format: ExportFormat) => {
    if (!chart) return;
    try {
      setExportMenuOpen(false);
      await exportDiagram(containerRef.current, chart.meta?.title ?? "thought-flow", format, chart);
    } catch (err) {
      console.warn(`[export] failed to export ${format}:`, err);
    }
  }, [chart]);

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

      {/* HTML title overlay — follows the chart via the same vp transform */}
      {titleInfo && size && chart && chart.meta.title !== "Untitled" && (() => {
        const x = vp.x + titleInfo.divX * vp.scale;
        const y = vp.y + titleInfo.divY * vp.scale;
        return (
          <div
            data-chart-title="true"
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: "translateX(-50%)",
              fontSize: Math.max(11, 22 * vp.scale),
              fontWeight: 700,
              color: "var(--chart-text)",
              whiteSpace: "nowrap",
              userSelect: "none",
              opacity: 0.9,
              cursor: onRenameTitle ? "text" : "default",
              lineHeight: 1,
              zIndex: 1,
            }}
            onDoubleClick={onRenameTitle ? (e) => {
              e.stopPropagation();
              const containerRect = containerRef.current!.getBoundingClientRect();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const w = Math.max(r.width + 40, 240);
              setEditingState({ kind: "title", text: chart.meta.title, left: r.left - containerRect.left + r.width / 2 - w / 2, top: r.top - containerRect.top, width: w, height: Math.max(r.height, 28) });
            } : undefined}
          >
            {chart.meta.title}
          </div>
        );
      })()}

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
            stroke="var(--chart-node-bg)"
            strokeWidth={2.5}
            strokeDasharray="6 4"
          />
        </svg>
      )}

      {editingState && (
        <input
          autoFocus
          value={editingState.text}
          onChange={(e) => setEditingState((s) => s ? { ...s, text: e.target.value } : null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitMermaidEdit(); }
            if (e.key === "Escape") setEditingState(null);
          }}
          onBlur={commitMermaidEdit}
          style={{
            position: "absolute",
            left: editingState.left,
            top: editingState.top,
            width: Math.max(editingState.width, 80),
            height: Math.max(editingState.height, 28),
            textAlign: "center",
            fontSize: 13,
            background: "var(--chart-node-bg)",
            color: "var(--chart-text)",
            border: "2px solid var(--chart-node-border)",
            borderRadius: 6,
            outline: "none",
            padding: "0 6px",
            zIndex: 10,
            boxShadow: "0 0 0 2px var(--chart-bg), 0 0 0 4px var(--chart-edge)",
          }}
        />
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
            active={!!activeNodeId}
          >
            {activeNodeId ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </ControlBtn>
          <ControlBtn
            onClick={copyMermaid}
            title={
              copyState === "copied"
                ? "Copied Mermaid"
                : copyState === "error"
                  ? "Copy failed"
                  : "Copy Mermaid"
            }
          >
            <Clipboard size={14} />
          </ControlBtn>
          <ExportMenu
            open={exportMenuOpen}
            onToggle={() => setExportMenuOpen((open) => !open)}
            onExport={(format) => void handleExport(format)}
          />
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

function ExportMenu({
  open,
  onToggle,
  onExport,
}: {
  open: boolean;
  onToggle: () => void;
  onExport: (format: ExportFormat) => void;
}) {
  return (
    <div className="relative">
      <ControlBtn onClick={onToggle} title="Export">
        <Download size={14} />
      </ControlBtn>
      {open && (
        <div className="absolute bottom-9 right-0 min-w-24 overflow-hidden rounded border border-border bg-primary text-[12px] text-foreground shadow-lg">
          {([
            "svg",
            "html",
            "ascii",
            // "png",
            // "pdf",
          ] as ExportFormat[]).map((format) => (
            <button
              key={format}
              onClick={() => onExport(format)}
              className="block w-full px-3 py-2 text-left uppercase hover:bg-secondary"
            >
              {format}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ControlBtn({ onClick, children, title, active }: { onClick: () => void; children: React.ReactNode; title?: string; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded border transition-colors cursor-default ${
        active 
          ? "bg-ring text-background border-ring" 
          : "bg-primary border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
      }`}
    >
      {children}
    </button>
  );
}
