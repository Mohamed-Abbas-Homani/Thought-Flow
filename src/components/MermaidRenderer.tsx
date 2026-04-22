import { useRef, useState, useCallback, useEffect } from "react";
import mermaid from "mermaid";
import type { ChartGraph } from "../lib/chart/types";
import { chartToMermaid } from "../lib/chart/mermaid";
import { useSettingsStore } from "../store/settingsStore";
import { useStreamingStore } from "../store/streamingStore";

// ── Types ──────────────────────────────────────────────────────

interface Viewport { x: number; y: number; scale: number; }

const MIN_SCALE      = 0.1;
const MAX_SCALE      = 4;
const ZOOM_SENSITIVITY = 0.0012;

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

function useMermaidSvg(chart: ChartGraph | null, isDark: boolean): string {
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

      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "neutral",
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
  }, [chart, isDark]);

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

// ── Component ─────────────────────────────────────────────────

interface MermaidRendererProps {
  chart: ChartGraph | null;
}

export function MermaidRenderer({ chart }: MermaidRendererProps) {
  const { colorMode } = useSettingsStore();
  const isDark = colorMode === "dark";
  const { isStreaming } = useStreamingStore();

  const svg = useMermaidSvg(chart, isDark);

  const containerRef = useRef<HTMLDivElement>(null);
  const [vp, setVp]  = useState<Viewport>({ x: 40, y: 40, scale: 1 });
  const vpRef        = useRef(vp);
  vpRef.current = vp;

  // Follow latest content during streaming; fit-to-view when done.
  useEffect(() => {
    if (!svg || !containerRef.current) return;
    const size = parseSvgSize(svg);
    if (!size) return;
    const rect = containerRef.current.getBoundingClientRect();

    if (isStreaming) {
      // Scroll to the bottom of the SVG (where new nodes appear) at a comfortable zoom.
      const scale = Math.min((rect.width * 0.8) / size.w, 0.85, 1.2);
      setVp({
        scale,
        x: (rect.width - size.w * scale) / 2,
        y: rect.height * 0.65 - size.h * scale,
      });
    } else {
      setVp(fitViewport(size.w, size.h, rect.width, rect.height));
      console.log(`[mermaid] fit-to-view — svg ${size.w.toFixed(0)}×${size.h.toFixed(0)}`);
    }
  }, [svg, isStreaming]);

  // ── Pan ────────────────────────────────────────────────────

  const isPanning = useRef(false);
  const panStart  = useRef({ x: 0, y: 0, vpX: 0, vpY: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
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
    if (!svg || !containerRef.current) return;
    const size = parseSvgSize(svg);
    if (!size) return;
    const rect = containerRef.current.getBoundingClientRect();
    setVp(fitViewport(size.w, size.h, rect.width, rect.height));
  }, [svg]);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-background select-none"
      style={{ cursor: "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
    >
      {svg && (
        <div
          style={{
            position: "absolute",
            transformOrigin: "0 0",
            transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`,
          }}
          // mermaid's SVG uses inline styles; override background so it respects our canvas
          className="[&_svg]:bg-transparent [&_svg]:max-w-none"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}

      {!chart && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-[13px] pointer-events-none">
          Send a message to generate a diagram
        </div>
      )}

      {chart && (
        <div className="absolute bottom-3 right-3 flex gap-1">
          <ControlBtn onClick={() => setVp((v) => zoomAt(v, 1.25, containerRef.current))}>+</ControlBtn>
          <ControlBtn onClick={() => setVp((v) => zoomAt(v, 0.8,  containerRef.current))}>−</ControlBtn>
          <ControlBtn onClick={fitView}>⊡</ControlBtn>
        </div>
      )}
    </div>
  );
}

// ── Control button ────────────────────────────────────────────

function ControlBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center rounded bg-primary border border-border text-muted-foreground hover:text-foreground hover:bg-secondary text-[14px] leading-none cursor-default"
    >
      {children}
    </button>
  );
}
