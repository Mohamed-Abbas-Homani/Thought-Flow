import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import type { ChartGraph } from "../../lib/chart/types";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Clipboard,
  Download,
  Play,
  Square,
  ZoomIn,
  ZoomOut,
  Maximize,
  Search,
} from "lucide-react";
import { chartToClipboardMermaid } from "../../lib/chart/mermaid";
import { exportDiagram, type ExportFormat } from "../../lib/exportDiagram";
import { computeLayout } from "./layout";
import { NodeShape } from "./NodeShape";
import { EdgePath } from "./EdgePath";
import { useStreamingStore } from "../../store/streamingStore";

// ── Viewport state ────────────────────────────────────────────

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const ZOOM_SENSITIVITY = 0.0012;

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

// ── Fit-to-view helper ────────────────────────────────────────

function fitViewport(
  diagramW: number,
  diagramH: number,
  containerW: number,
  containerH: number,
  padding = 40,
): Viewport {
  if (diagramW === 0 || diagramH === 0) return { x: 0, y: 0, scale: 1 };
  const scale = Math.min(
    (containerW - padding * 2) / diagramW,
    (containerH - padding * 2) / diagramH,
    1.2,
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
  onRenameNode?: (nodeId: string, newText: string) => void;
  onRenameEdge?: (
    from: string,
    to: string,
    currentLabel: string,
    newLabel: string,
  ) => void;
  onRenameTitle?: (newTitle: string) => void;
}

interface EdgeEdit {
  from: string;
  to: string;
  currentLabel: string;
  value: string;
  screenX: number;
  screenY: number;
}

export function Flowchart({
  chart,
  error,
  onRenameNode,
  onRenameEdge,
  onRenameTitle,
}: FlowchartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>({ x: 40, y: 40, scale: 1 });
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingEdge, setEditingEdge] = useState<EdgeEdit | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const { isStreaming } = useStreamingStore();

  const layout = useMemo(() => (chart ? computeLayout(chart) : null), [chart]);

  const titleNode = useMemo(() => {
    if (!layout || !chart?.meta.title || chart.meta.title === "Untitled")
      return null;
    return (
      layout.nodes.find((n) => n.type === "start") ?? layout.nodes[0] ?? null
    );
  }, [layout, chart]);

  const prevNodeCount = useRef(0);
  const prevEdgeCount = useRef(0);
  const prevHeight = useRef(0);

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
        x: rect.width / 2 - lastNode.x * scale,
        y: rect.height * 0.65 - lastNode.y * scale,
      });
    } else {
      // Not streaming: fit-to-view on first content or significant growth.
      const firstNodes = prevNodeCount.current === 0 && layout.nodes.length > 0;
      const firstEdges = prevEdgeCount.current === 0 && layout.edges.length > 0;
      const biggerChart =
        layout.height > prevHeight.current * 1.4 && prevHeight.current > 0;
      if (firstNodes || firstEdges || biggerChart) {
        setVp(
          fitViewport(layout.width, layout.height, rect.width, rect.height),
        );
        console.log(
          `[layout] fit-to-view triggered — ${layout.nodes.length} nodes, ${layout.edges.length} edges`,
        );
      }
    }

    prevNodeCount.current = layout.nodes.length;
    prevEdgeCount.current = layout.edges.length;
    prevHeight.current = layout.height;
  }, [layout, isStreaming]);

  // ── Pan ──────────────────────────────────────────────────

  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, vpX: 0, vpY: 0 });

  function commitEdit() {
    if (!editingNodeId) return;
    const text = editingValue.trim();
    if (text) onRenameNode?.(editingNodeId, text);
    setEditingNodeId(null);
    setEditingValue("");
  }

  function startEdit(nodeId: string, currentText: string) {
    setEditingNodeId(nodeId);
    setEditingValue(currentText.replace(/^["']|["']$/g, "").trim());
  }

  function commitEdgeEdit() {
    if (!editingEdge) return;
    const newLabel = editingEdge.value.trim();
    onRenameEdge?.(
      editingEdge.from,
      editingEdge.to,
      editingEdge.currentLabel,
      newLabel,
    );
    setEditingEdge(null);
  }

  function commitTitleEdit() {
    const text = editingTitleValue.trim();
    if (text) onRenameTitle?.(text);
    setEditingTitle(false);
  }

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      if (editingNodeId) {
        setEditingNodeId(null);
        setEditingValue("");
        return;
      }
      if (editingEdge) {
        setEditingEdge(null);
        return;
      }
      if (editingTitle) {
        setEditingTitle(false);
        return;
      }
      if ((e.target as SVGElement).closest("[data-node]")) return;
      if ((e.target as SVGElement).closest("[data-edge-label]")) return;
      if ((e.target as SVGElement).closest("[data-chart-title]")) return;
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY, vpX: vp.x, vpY: vp.y };
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      e.currentTarget.style.cursor = "grabbing";
    },
    [vp.x, vp.y],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setVp((v) => ({
      ...v,
      x: panStart.current.vpX + dx,
      y: panStart.current.vpY + dy,
    }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    isPanning.current = false;
    e.currentTarget.style.cursor = "";
  }, []);

  // ── Zoom ─────────────────────────────────────────────────

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const delta = -e.deltaY * ZOOM_SENSITIVITY;
    setVp((v) => {
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, v.scale * (1 + delta)),
      );
      const factor = newScale / v.scale;
      return {
        scale: newScale,
        x: cx - (cx - v.x) * factor,
        y: cy - (cy - v.y) * factor,
      };
    });
  }, []);

  // ── Navigation ─────────────────────────────────────────────

  useEffect(() => {
    if (!activeNodeId || !layout || !containerRef.current) return;

    const node = layout.nodes.find((n) => n.id === activeNodeId);
    if (!node) return;

    const rect = containerRef.current.getBoundingClientRect();
    // Zoom in comfortably on the active node
    const scale = Math.max(vp.scale, 1.1);
    setVp({
      scale,
      x: rect.width / 2 - node.x * scale,
      y: rect.height / 2 - node.y * scale,
    });
  }, [activeNodeId]);

  useEffect(() => {
    if (!activeNodeId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!chart) return;

      // Find parent (incoming edge)
      const incoming = chart.edges.filter((ev) => ev.to === activeNodeId);
      const parentId = incoming.length > 0 ? incoming[0].from : null;

      // Find siblings (all children of my parent)
      const siblings = parentId
        ? chart.edges.filter((ev) => ev.from === parentId).map((ev) => ev.to)
        : [];

      const outgoing = chart.edges.filter((ev) => ev.from === activeNodeId);

      if (e.key === "ArrowDown" || e.key === "Enter") {
        if (outgoing.length > 0) setActiveNodeId(outgoing[0].to);
      } else if (e.key === "ArrowUp" || e.key === "Backspace") {
        if (parentId) setActiveNodeId(parentId);
      } else if (e.key === "ArrowRight") {
        const idx = siblings.indexOf(activeNodeId);
        if (idx !== -1 && idx < siblings.length - 1)
          setActiveNodeId(siblings[idx + 1]);
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
    // Start at n1 or first node
    const startNode = chart.nodes.find((n) => n.id === "n1") || chart.nodes[0];
    setActiveNodeId(startNode.id);
  };

  const fitView = useCallback(() => {
    if (!layout || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setVp(fitViewport(layout.width, layout.height, rect.width, rect.height));
  }, [layout]);

  const searchNode = useCallback(() => {
    if (!chart) return;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;
    const matches = chart.nodes.filter(
      (node) =>
        node.id.toLowerCase().includes(query) ||
        node.text.toLowerCase().includes(query),
    );
    if (matches.length === 0) return;
    const currentIndex = activeNodeId
      ? matches.findIndex((node) => node.id === activeNodeId)
      : -1;
    setActiveNodeId(matches[(currentIndex + 1) % matches.length].id);
  }, [activeNodeId, chart, searchQuery]);

  const copyMermaid = useCallback(async () => {
    if (!chart) return;
    try {
      await writeText(chartToClipboardMermaid(chart, clipboardThemeTokens()));
      setCopyState("copied");
    } catch (err) {
      console.warn(
        "[clipboard] failed to copy Mermaid from custom renderer:",
        err,
      );
      setCopyState("error");
    }
  }, [chart]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  useEffect(() => {
    if (!exportNotice) return;
    const timer = window.setTimeout(() => setExportNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [exportNotice]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!chart) return;
      try {
        setExportMenuOpen(false);
        await exportDiagram(
          containerRef.current,
          chart.meta?.title ?? "thought-flow",
          format,
          chart,
        );
        setExportNotice("Saved to Downloads");
      } catch (err) {
        console.warn(`[export] failed to export ${format}:`, err);
      }
    },
    [chart],
  );

  // ── Render ────────────────────────────────────────────────

  const hasContent = layout && layout.nodes.length > 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-chart-bg select-none"
    >
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
              {titleNode && chart && (
                <text
                  data-chart-title="true"
                  x={titleNode.x}
                  y={titleNode.y - titleNode.h / 2 - 24}
                  textAnchor="middle"
                  dominantBaseline="auto"
                  fontSize={22}
                  fontWeight="700"
                  fill="var(--chart-text)"
                  style={{
                    userSelect: "none",
                    opacity: 0.9,
                    cursor: onRenameTitle ? "text" : undefined,
                  }}
                  onDoubleClick={
                    onRenameTitle
                      ? (e) => {
                          e.stopPropagation();
                          setEditingTitle(true);
                          setEditingTitleValue(chart.meta.title);
                        }
                      : undefined
                  }
                >
                  {chart.meta.title}
                </text>
              )}
              {layout.edges.map((edge, i) => (
                <EdgePath
                  key={`${edge.from}→${edge.to}→${i}`}
                  edge={edge}
                  onLabelDoubleClick={
                    onRenameEdge && edge.label
                      ? (clientX, clientY) => {
                          const rect =
                            containerRef.current!.getBoundingClientRect();
                          setEditingEdge({
                            from: edge.from,
                            to: edge.to,
                            currentLabel: edge.label!,
                            value: edge.label!,
                            screenX: clientX - rect.left,
                            screenY: clientY - rect.top,
                          });
                        }
                      : undefined
                  }
                />
              ))}
              {layout.nodes.map((node) => (
                <g
                  key={node.id}
                  data-node={node.id}
                  onClick={
                    activeNodeId
                      ? (e) => {
                          e.stopPropagation();
                          setActiveNodeId(node.id);
                        }
                      : undefined
                  }
                >
                  <NodeShape
                    node={node}
                    focused={activeNodeId === node.id}
                    onDoubleClick={
                      onRenameNode
                        ? () => startEdit(node.id, node.text)
                        : undefined
                    }
                  />
                </g>
              ))}
            </>
          )}
        </g>
      </svg>

      {editingNodeId &&
        layout &&
        (() => {
          const node = layout.nodes.find((n) => n.id === editingNodeId);
          if (!node) return null;
          const cx = node.x * vp.scale + vp.x;
          const cy = node.y * vp.scale + vp.y;
          const iw = Math.max(node.w * vp.scale, 80);
          const ih = Math.max(node.h * vp.scale, 28);
          return (
            <input
              autoFocus
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitEdit();
                }
                if (e.key === "Escape") {
                  setEditingNodeId(null);
                  setEditingValue("");
                }
              }}
              onBlur={commitEdit}
              style={{
                position: "absolute",
                left: cx - iw / 2,
                top: cy - ih / 2,
                width: iw,
                height: ih,
                textAlign: "center",
                fontSize: Math.max(10, 12 * vp.scale),
                background: "var(--chart-node-bg)",
                color: "var(--chart-text)",
                border: "2px solid var(--chart-node-border)",
                borderRadius: 6,
                outline: "none",
                padding: "0 6px",
                zIndex: 10,
                boxShadow:
                  "0 0 0 2px var(--chart-bg), 0 0 0 4px var(--chart-edge)",
              }}
            />
          );
        })()}

      {editingEdge && (
        <input
          autoFocus
          value={editingEdge.value}
          onChange={(e) =>
            setEditingEdge((s) => (s ? { ...s, value: e.target.value } : null))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitEdgeEdit();
            }
            if (e.key === "Escape") setEditingEdge(null);
          }}
          onBlur={commitEdgeEdit}
          style={{
            position: "absolute",
            left: editingEdge.screenX - 50,
            top: editingEdge.screenY - 13,
            width: 100,
            height: 26,
            textAlign: "center",
            fontSize: 11,
            background: "var(--chart-node-bg)",
            color: "var(--chart-text)",
            border: "2px solid var(--chart-edge)",
            borderRadius: 5,
            outline: "none",
            padding: "0 4px",
            zIndex: 10,
            boxShadow: "0 0 0 2px var(--chart-bg)",
          }}
        />
      )}

      {editingTitle && titleNode && (
        <input
          autoFocus
          value={editingTitleValue}
          onChange={(e) => setEditingTitleValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitleEdit();
            }
            if (e.key === "Escape") setEditingTitle(false);
          }}
          onBlur={commitTitleEdit}
          style={{
            position: "absolute",
            left: titleNode.x * vp.scale + vp.x - 120,
            top: (titleNode.y - titleNode.h / 2 - 24) * vp.scale + vp.y - 14,
            width: 240,
            height: 28,
            textAlign: "center",
            fontSize: Math.max(13, 22 * vp.scale),
            fontWeight: 700,
            background: "var(--chart-node-bg)",
            color: "var(--chart-text)",
            border: "2px solid var(--chart-node-border)",
            borderRadius: 6,
            outline: "none",
            padding: "0 8px",
            zIndex: 10,
            boxShadow: "0 0 0 2px var(--chart-bg), 0 0 0 4px var(--chart-edge)",
          }}
        />
      )}

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
        <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2">
          {exportNotice && (
            <div className="rounded-md border border-border bg-primary px-3 py-1.5 text-[12px] text-foreground shadow-lg">
              {exportNotice}
            </div>
          )}
          <div className="flex gap-1">
            <ControlBtn
              onClick={
                activeNodeId ? () => setActiveNodeId(null) : startNavigation
              }
              title={
                activeNodeId
                  ? "Stop Playback"
                  : "Start Playback (Arrow keys to navigate)"
              }
              active={!!activeNodeId}
            >
              {activeNodeId ? (
                <Square size={14} fill="currentColor" />
              ) : (
                <Play size={14} fill="currentColor" />
              )}
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
            <ControlBtn
              onClick={() =>
                setVp((v) => zoomAt(v, 1.25, containerRef.current))
              }
            >
              <ZoomIn size={14} />
            </ControlBtn>
            <ControlBtn
              onClick={() => setVp((v) => zoomAt(v, 0.8, containerRef.current))}
            >
              <ZoomOut size={14} />
            </ControlBtn>
            <form
              className="flex h-7 items-center overflow-hidden rounded border border-border bg-primary"
              onSubmit={(e) => {
                e.preventDefault();
                searchNode();
              }}
            >
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                className="h-full w-24 bg-transparent px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50"
              />
              <button
                type="submit"
                title="Find node"
                className="flex h-full w-7 items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <Search size={13} />
              </button>
            </form>
            <ControlBtn onClick={fitView}>
              <Maximize size={14} />
            </ControlBtn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Utility: zoom at centre of container ─────────────────────

function zoomAt(
  vp: Viewport,
  factor: number,
  el: HTMLElement | null,
): Viewport {
  if (!el) return vp;
  const rect = el.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vp.scale * factor));
  const f = newScale / vp.scale;
  return { scale: newScale, x: cx - (cx - vp.x) * f, y: cy - (cy - vp.y) * f };
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
          {(
            [
              "svg",
              "html",
              "ascii",
              // "png",
              // "pdf",
            ] as ExportFormat[]
          ).map((format) => (
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

function ControlBtn({
  onClick,
  children,
  title,
  active,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  active?: boolean;
}) {
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
