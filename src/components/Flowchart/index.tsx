import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import type { ChartGraph } from "../../lib/chart/types";
import { computeLayout } from "./layout";
import { NodeShape } from "./NodeShape";
import { EdgePath } from "./EdgePath";
import { useStreamingStore } from "../../store/streamingStore";

// ── Viewport state ────────────────────────────────────────────

interface Viewport { x: number; y: number; scale: number; }

const MIN_SCALE      = 0.15;
const MAX_SCALE      = 3;
const ZOOM_SENSITIVITY = 0.0012;

// ── Fit-to-view helper ────────────────────────────────────────

function fitViewport(
  diagramW: number, diagramH: number,
  containerW: number, containerH: number,
  padding = 40
): Viewport {
  if (diagramW === 0 || diagramH === 0) return { x: 0, y: 0, scale: 1 };
  const scale = Math.min(
    (containerW - padding * 2) / diagramW,
    (containerH - padding * 2) / diagramH,
    1.2
  );
  return {
    scale,
    x: (containerW - diagramW * scale) / 2,
    y: (containerH - diagramH * scale) / 2,
  };
}

// ── Component ─────────────────────────────────────────────────

interface FlowchartProps {
  chart: ChartGraph | null;
  error?: string | null;
}

export function Flowchart({ chart, error }: FlowchartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vp, setVp]  = useState<Viewport>({ x: 40, y: 40, scale: 1 });
  const vpRef        = useRef(vp);
  vpRef.current = vp;

  const { isStreaming } = useStreamingStore();

  const layout = useMemo(
    () => (chart ? computeLayout(chart) : null),
    [chart]
  );

  const prevNodeCount = useRef(0);
  const prevEdgeCount = useRef(0);
  const prevHeight    = useRef(0);

  useEffect(() => {
    if (!layout || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    if (isStreaming && layout.nodes.length > 0) {
      // During streaming: follow the bottom-most node (latest generated) at a
      // comfortable zoom so the user can see the chart being built in real time.
      const lastNode = layout.nodes.reduce((a, b) => (a.y > b.y ? a : b));
      const scale = 0.75;
      setVp({
        scale,
        x: rect.width  / 2 - lastNode.x * scale,
        y: rect.height * 0.65 - lastNode.y * scale,
      });
    } else {
      // Not streaming: fit-to-view on first content or significant growth.
      const firstNodes  = prevNodeCount.current === 0 && layout.nodes.length > 0;
      const firstEdges  = prevEdgeCount.current === 0 && layout.edges.length > 0;
      const biggerChart = layout.height > prevHeight.current * 1.4 && prevHeight.current > 0;
      if (firstNodes || firstEdges || biggerChart) {
        setVp(fitViewport(layout.width, layout.height, rect.width, rect.height));
        console.log(`[layout] fit-to-view triggered — ${layout.nodes.length} nodes, ${layout.edges.length} edges`);
      }
    }

    prevNodeCount.current = layout.nodes.length;
    prevEdgeCount.current = layout.edges.length;
    prevHeight.current    = layout.height;
  }, [layout, isStreaming]);

  // ── Pan ──────────────────────────────────────────────────

  const isPanning = useRef(false);
  const panStart  = useRef({ x: 0, y: 0, vpX: 0, vpY: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if ((e.target as SVGElement).closest("[data-node]")) return;
    isPanning.current = true;
    panStart.current  = { x: e.clientX, y: e.clientY, vpX: vp.x, vpY: vp.y };
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = "grabbing";
  }, [vp.x, vp.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setVp((v) => ({ ...v, x: panStart.current.vpX + dx, y: panStart.current.vpY + dy }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    isPanning.current = false;
    e.currentTarget.style.cursor = "";
  }, []);

  // ── Zoom ─────────────────────────────────────────────────

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
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

  // ── Fit button ────────────────────────────────────────────

  const fitView = useCallback(() => {
    if (!layout || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setVp(fitViewport(layout.width, layout.height, rect.width, rect.height));
  }, [layout]);

  // ── Render ────────────────────────────────────────────────

  const hasContent = layout && layout.nodes.length > 0;

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-background select-none">
      <svg
        className="w-full h-full"
        style={{ cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        <g
          style={{
            transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`,
            transformOrigin: "0 0",
          }}
        >
          {hasContent && (
            <>
              {layout.edges.map((edge, i) => (
                <EdgePath key={`${edge.from}→${edge.to}→${i}`} edge={edge} />
              ))}
              {layout.nodes.map((node) => (
                <g key={node.id} data-node={node.id}>
                  <NodeShape node={node} />
                </g>
              ))}
            </>
          )}
        </g>
      </svg>

      {error && (
        <div className="absolute bottom-3 left-3 right-3 bg-background/90 border border-error/40 rounded-md px-3 py-2 text-[12px] font-mono text-error backdrop-blur-sm">
          {error}
        </div>
      )}

      {!hasContent && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-[13px] pointer-events-none">
          Send a message to generate a diagram
        </div>
      )}

      {hasContent && (
        <div className="absolute bottom-3 right-3 flex gap-1">
          <ControlBtn onClick={() => setVp((v) => zoomAt(v, 1.25, containerRef.current))}>+</ControlBtn>
          <ControlBtn onClick={() => setVp((v) => zoomAt(v, 0.8,  containerRef.current))}>−</ControlBtn>
          <ControlBtn onClick={fitView}>⊡</ControlBtn>
        </div>
      )}
    </div>
  );
}

// ── Utility: zoom at centre of container ─────────────────────

function zoomAt(vp: Viewport, factor: number, el: HTMLElement | null): Viewport {
  if (!el) return vp;
  const rect     = el.getBoundingClientRect();
  const cx       = rect.width  / 2;
  const cy       = rect.height / 2;
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vp.scale * factor));
  const f        = newScale / vp.scale;
  return { scale: newScale, x: cx - (cx - vp.x) * f, y: cy - (cy - vp.y) * f };
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
