import dagre from "dagre";
import type { ChartGraph, ChartNode, ChartEdge } from "../../lib/chart/types";

// ── Node geometry ─────────────────────────────────────────────

export interface LayoutNode extends ChartNode {
  x: number; // centre
  y: number; // centre
  w: number;
  h: number;
}

export interface LayoutEdge extends ChartEdge {
  points: { x: number; y: number }[];
  isBack: boolean;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

// Per-shape dimensions (total bbox, centred at x/y)
const SHAPE_SIZE: Record<string, { w: number; h: number }> = {
  diamond:         { w: 160, h: 88 },
  "double-circle": { w: 100, h: 100 },
  hexagon:         { w: 174, h: 62 },
  cylinder:        { w: 148, h: 68 },
  default:         { w: 180, h: 52 },
};

function nodeSize(shape: string): { w: number; h: number } {
  return SHAPE_SIZE[shape] ?? SHAPE_SIZE.default;
}

function intersectShape(node: LayoutNode, point: { x: number; y: number }) {
  const { shape, x, y, w, h } = node;
  const dx = point.x - x;
  const dy = point.y - y;
  let hw = w / 2;
  let hh = h / 2;

  if (!dx && !dy) return { x, y };

  if (shape === "diamond") {
    const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    return { x: x + dx * t, y: y + dy * t };
  }

  if (shape === "double-circle" || shape === "circle") {
    const r = Math.min(hw, hh);
    const len = Math.sqrt(dx * dx + dy * dy);
    const t = r / len;
    return { x: x + dx * t, y: y + dy * t };
  }

  let sx = 0;
  let sy = 0;
  if (Math.abs(dy) * hw > Math.abs(dx) * hh) {
    if (dy < 0) hh = -hh;
    sx = (hh * dx) / dy;
    sy = hh;
  } else {
    if (dx < 0) hw = -hw;
    sx = hw;
    sy = (hw * dy) / dx;
  }
  return { x: x + sx, y: y + sy };
}

// ── Main layout function ─────────────────────────────────────

export function computeLayout(chart: ChartGraph): Layout {
  const { nodes, edges } = chart;
  const dir = chart.meta.direction;

  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB", // LR disabled
    marginx: 40,
    marginy: 80, // extra top margin accommodates the chart title
    ranksep: 80,
    nodesep: 48,
    edgesep: 15,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const size = nodeSize(n.shape);
    g.setNode(n.id, { width: size.w, height: size.h, ...n });
  }

  // To detect backwards edges visually if needed
  for (const e of edges) {
    g.setEdge(e.from, e.to, { originalEdge: e });
  }

  dagre.layout(g);

  const placedNodeMap = new Map<string, LayoutNode>();
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const id of g.nodes()) {
    const out = g.node(id);
    if (!out) continue;
    
    // The properties we spread injected during setNode
    const n = out as any;
    
    const nodeOut: LayoutNode = {
      ...n,
      x:      out.x,
      y:      out.y,
      w:      out.width,
      h:      out.height,
    };
    placedNodeMap.set(id, nodeOut);

    minX = Math.min(minX, out.x - out.width / 2);
    minY = Math.min(minY, out.y - out.height / 2);
    maxX = Math.max(maxX, out.x + out.width / 2);
    maxY = Math.max(maxY, out.y + out.height / 2);
  }

  const placedEdges: LayoutEdge[] = [];

  for (const e of g.edges()) {
    const out = g.edge(e);
    if (!out) continue;
    
    const srcNode = placedNodeMap.get(e.v);
    const dstNode = placedNodeMap.get(e.w);
    
    if (!srcNode || !dstNode) continue;
    const originEdges = edges.filter(ce => ce.from === e.v && ce.to === e.w);
    
    // Handle edge points (Dagre routes them beautifully avoiding nodes)
    let points = out.points ? [...out.points] : [];
    
    if (points.length >= 2) {
      // Pull endpoints to shape intersections
      const startInner = points[1] || dstNode;
      const endInner   = points[points.length - 2] || srcNode;
      points[0] = intersectShape(srcNode, startInner);
      points[points.length - 1] = intersectShape(dstNode, endInner);
    } else {
      const start = intersectShape(srcNode, dstNode);
      const end   = intersectShape(dstNode, srcNode);
      points = [start, end];
    }
    
    // Add to bound dimensions
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    // Default dagre marks cycles sometimes, but we will treat all edges structurally identically
    // except we can determine 'isBack' if it goes against the rank dir visually
    const isBack = dir === "horizontal" ? dstNode.x < srcNode.x : dstNode.y < srcNode.y;

    for (const originalEdge of originEdges) {
      placedEdges.push({
        ...originalEdge,
        points: points,
        isBack
      });
    }
  }

  const graphSize = g.graph();

  return {
    nodes: Array.from(placedNodeMap.values()),
    edges: placedEdges,
    width:  Math.max(graphSize.width ?? (maxX - minX + 80), 0),
    height: Math.max(graphSize.height ?? (maxY - minY + 80), 0),
  };
}
