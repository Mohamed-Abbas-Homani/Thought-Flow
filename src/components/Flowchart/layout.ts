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

const RANK_GAP = 90;  // vertical gap between layers (TB)
const NODE_SEP = 48;  // horizontal gap between siblings (TB)
const PADDING  = 72;  // canvas margin

// ── Main layout function ─────────────────────────────────────

export function computeLayout(chart: ChartGraph): Layout {
  const { nodes, edges } = chart;
  const dir = chart.meta.direction; // "horizontal" | "vertical"

  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  // 1. Identify "back" (loop/jump) edges — excluded from rank assignment
  const backEdgeSet = new Set<string>();
  for (const e of edges) {
    if (e.type === "loop" || e.type === "jump") {
      backEdgeSet.add(`${e.from}→${e.to}`);
    }
  }

  // 2. Build forward adjacency + in-degree
  const adj     = new Map<string, string[]>();
  const predAdj = new Map<string, string[]>();
  const inDeg   = new Map<string, number>();

  for (const n of nodes) { adj.set(n.id, []); predAdj.set(n.id, []); inDeg.set(n.id, 0); }

  for (const e of edges) {
    if (backEdgeSet.has(`${e.from}→${e.to}`)) continue;
    adj.get(e.from)?.push(e.to);
    predAdj.get(e.to)?.push(e.from);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }

  // 3. BFS rank assignment (longest path from source)
  const rank  = new Map<string, number>();
  const queue: string[] = [];

  for (const n of nodes) {
    if ((inDeg.get(n.id) ?? 0) === 0) { rank.set(n.id, 0); queue.push(n.id); }
  }
  if (queue.length === 0 && nodes.length > 0) {
    rank.set(nodes[0].id, 0);
    queue.push(nodes[0].id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const r  = rank.get(id) ?? 0;
    for (const nxt of adj.get(id) ?? []) {
      const newRank = Math.max(rank.get(nxt) ?? 0, r + 1);
      rank.set(nxt, newRank);
      inDeg.set(nxt, (inDeg.get(nxt) ?? 0) - 1);
      if ((inDeg.get(nxt) ?? 0) <= 0) queue.push(nxt);
    }
  }

  // 4. Group nodes by rank
  const layers = new Map<number, string[]>();
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0;
    if (!layers.has(r)) layers.set(r, []);
    layers.get(r)!.push(n.id);
  }

  // 5. Sort within each layer by barycenter of predecessors
  const posX = new Map<string, number>();
  for (const [r, ids] of [...layers.entries()].sort(([a], [b]) => a - b)) {
    if (r > 0) {
      ids.sort((a, b) => {
        const bca = avgPos(predAdj.get(a) ?? [], posX);
        const bcb = avgPos(predAdj.get(b) ?? [], posX);
        return bca - bcb;
      });
    }
    ids.forEach((id, i) => posX.set(id, i));
  }

  // 6. Assign pixel coordinates
  const nodeById = new Map<string, ChartNode>(nodes.map((n) => [n.id, n]));
  const placed   = new Map<string, LayoutNode>();

  for (const [r, ids] of layers) {
    const sizes  = ids.map((id) => nodeSize(nodeById.get(id)!.shape));
    const totalW = sizes.reduce((s, sz) => s + sz.w, 0) + (ids.length - 1) * NODE_SEP;

    let offsetX = -totalW / 2;

    ids.forEach((id, i) => {
      const sz = sizes[i];
      const cx = offsetX + sz.w / 2;
      const cy = r * (SHAPE_SIZE.default.h + RANK_GAP);

      placed.set(id, {
        ...nodeById.get(id)!,
        x: dir === "horizontal" ? cy : cx,
        y: dir === "horizontal" ? cx : cy,
        w: dir === "horizontal" ? sz.h : sz.w,
        h: dir === "horizontal" ? sz.w : sz.h,
      });

      offsetX += sz.w + NODE_SEP;
    });
  }

  // 7. Route edges
  const layoutEdges: LayoutEdge[] = edges.map((e) => {
    const src    = placed.get(e.from);
    const dst    = placed.get(e.to);
    const isBack = backEdgeSet.has(`${e.from}→${e.to}`);
    if (!src || !dst) return { ...e, points: [], isBack };
    return { ...e, points: routeEdge(src, dst, dir, isBack), isBack };
  });

  // 8. Compute canvas bounding box
  const allX = [...placed.values()].flatMap((n) => [n.x - n.w / 2, n.x + n.w / 2]);
  const allY = [...placed.values()].flatMap((n) => [n.y - n.h / 2, n.y + n.h / 2]);
  const minX = Math.min(...allX) - PADDING;
  const minY = Math.min(...allY) - PADDING;
  const maxX = Math.max(...allX) + PADDING;
  const maxY = Math.max(...allY) + PADDING;

  for (const n of placed.values()) { n.x -= minX; n.y -= minY; }
  for (const e of layoutEdges) {
    e.points = e.points.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  }

  return {
    nodes: [...placed.values()],
    edges: layoutEdges,
    width:  maxX - minX,
    height: maxY - minY,
  };
}

// ── Edge routing ─────────────────────────────────────────────

function routeEdge(
  src: LayoutNode,
  dst: LayoutNode,
  dir: "horizontal" | "vertical",
  isBack: boolean
): { x: number; y: number }[] {
  const tb = dir === "vertical";

  if (isBack) {
    const margin = 60;
    if (tb) {
      const left = Math.min(src.x - src.w / 2, dst.x - dst.w / 2) - margin;
      return [
        { x: src.x - src.w / 2, y: src.y },
        { x: left,               y: src.y },
        { x: left,               y: dst.y },
        { x: dst.x - dst.w / 2, y: dst.y },
      ];
    } else {
      const top = Math.min(src.y - src.h / 2, dst.y - dst.h / 2) - margin;
      return [
        { x: src.x, y: src.y - src.h / 2 },
        { x: src.x, y: top               },
        { x: dst.x, y: top               },
        { x: dst.x, y: dst.y - dst.h / 2 },
      ];
    }
  }

  const exit  = tb ? { x: src.x, y: src.y + src.h / 2 } : { x: src.x + src.w / 2, y: src.y };
  const enter = tb ? { x: dst.x, y: dst.y - dst.h / 2 } : { x: dst.x - dst.w / 2, y: dst.y };
  return [exit, enter];
}

// ── Helpers ───────────────────────────────────────────────────

function avgPos(ids: string[], posMap: Map<string, number>): number {
  if (ids.length === 0) return 0;
  const sum = ids.reduce((s, id) => s + (posMap.get(id) ?? 0), 0);
  return sum / ids.length;
}
