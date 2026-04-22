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

const RANK_GAP  = 90;  // vertical gap between layers (TB)
const NODE_SEP  = 48;  // horizontal gap between siblings
const PADDING   = 80;  // canvas margin (slightly larger to accommodate back-edge routing)
const BACK_MARGIN = 70; // extra space on the right for backward edge arcs

// ── Main layout function ─────────────────────────────────────

export function computeLayout(chart: ChartGraph): Layout {
  const { nodes, edges } = chart;
  const dir = chart.meta.direction;

  console.log(`[layout] computeLayout — ${nodes.length} nodes, ${edges.length} edges, dir=${dir}`);
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  // ── 1. Build full adjacency ──────────────────────────────────
  const allAdj = new Map<string, string[]>();
  for (const n of nodes) allAdj.set(n.id, []);
  for (const e of edges)  allAdj.get(e.from)?.push(e.to);

  // ── 2. Shortest-path BFS — "natural" rank of each node ───────
  //    First time a node is reached = its shortest-path rank.
  //    This gives us the rank each node *should* occupy regardless
  //    of long-range cross-edges.
  const shortRank = new Map<string, number>();
  {
    const inDegFull = new Map<string, number>();
    for (const n of nodes) inDegFull.set(n.id, 0);
    for (const e of edges)  inDegFull.set(e.to, (inDegFull.get(e.to) ?? 0) + 1);

    const q: string[] = [];
    for (const n of nodes) {
      if ((inDegFull.get(n.id) ?? 0) === 0) { shortRank.set(n.id, 0); q.push(n.id); }
    }
    // Fallback if graph has no source
    if (q.length === 0 && nodes.length > 0) { shortRank.set(nodes[0].id, 0); q.push(nodes[0].id); }

    while (q.length > 0) {
      const id = q.shift()!;
      const r  = shortRank.get(id) ?? 0;
      for (const nxt of allAdj.get(id) ?? []) {
        if (!shortRank.has(nxt)) { shortRank.set(nxt, r + 1); q.push(nxt); }
      }
    }
    // Fallback for nodes not reachable from any source
    for (const n of nodes) { if (!shortRank.has(n.id)) shortRank.set(n.id, 0); }
  }

  // ── 3. Identify backward edges ───────────────────────────────
  //    An edge (u → v) is "backward" when its source has a
  //    ≥ shortest-path rank than its target.  These represent
  //    loops or cross-connections that visually go upward.
  const backEdgeSet = new Set<string>();
  for (const e of edges) {
    const fr = shortRank.get(e.from) ?? 0;
    const tr = shortRank.get(e.to)   ?? 0;
    if (fr >= tr) backEdgeSet.add(`${e.from}→${e.to}`);
  }

  // ── 4. Forward-only adjacency + in-degree ────────────────────
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

  // ── 5. Longest-path BFS rank assignment (forward edges only) ─
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

  console.log(`[layout] ranks: ${nodes.map(n => `${n.id}=r${rank.get(n.id) ?? '?'}`).join(', ')}`);
  console.log(`[layout] back edges (${backEdgeSet.size}): ${[...backEdgeSet].join(', ') || 'none'}`);

  // ── 6. Group nodes by rank ───────────────────────────────────
  const layers = new Map<number, string[]>();
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0;
    if (!layers.has(r)) layers.set(r, []);
    layers.get(r)!.push(n.id);
  }

  // ── 7. Barycenter sort within each layer ─────────────────────
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

  // ── 8. Assign pixel coordinates ──────────────────────────────
  const nodeById = new Map<string, ChartNode>(nodes.map(n => [n.id, n]));
  const placed   = new Map<string, LayoutNode>();

  for (const [r, ids] of layers) {
    const sizes  = ids.map(id => nodeSize(nodeById.get(id)!.shape));
    const totalW = sizes.reduce((s, sz) => s + sz.w, 0) + (ids.length - 1) * NODE_SEP;
    let offsetX  = -totalW / 2;

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

  // ── 9. Route edges ───────────────────────────────────────────
  const layoutEdges: LayoutEdge[] = edges.map(e => {
    const src    = placed.get(e.from);
    const dst    = placed.get(e.to);
    const isBack = backEdgeSet.has(`${e.from}→${e.to}`);
    if (!src || !dst) return { ...e, points: [], isBack };
    return { ...e, points: routeEdge(src, dst, dir, isBack), isBack };
  });

  // ── 10. Bounding box (include edge waypoints for back arcs) ──
  const allX = [
    ...[...placed.values()].flatMap(n => [n.x - n.w / 2, n.x + n.w / 2]),
    ...layoutEdges.flatMap(e => e.points.map(p => p.x)),
  ];
  const allY = [
    ...[...placed.values()].flatMap(n => [n.y - n.h / 2, n.y + n.h / 2]),
    ...layoutEdges.flatMap(e => e.points.map(p => p.y)),
  ];

  const minX = Math.min(...allX) - PADDING;
  const minY = Math.min(...allY) - PADDING;
  const maxX = Math.max(...allX) + PADDING;
  const maxY = Math.max(...allY) + PADDING;

  for (const n of placed.values()) { n.x -= minX; n.y -= minY; }
  for (const e of layoutEdges) {
    e.points = e.points.map(p => ({ x: p.x - minX, y: p.y - minY }));
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
    // Backward edges route around the RIGHT side (TB) or BOTTOM side (LR).
    // This keeps them visually separate from the main forward flow.
    if (tb) {
      const right = Math.max(src.x + src.w / 2, dst.x + dst.w / 2) + BACK_MARGIN;
      return [
        { x: src.x + src.w / 2, y: src.y },
        { x: right,              y: src.y },
        { x: right,              y: dst.y },
        { x: dst.x + dst.w / 2, y: dst.y },
      ];
    } else {
      const bottom = Math.max(src.y + src.h / 2, dst.y + dst.h / 2) + BACK_MARGIN;
      return [
        { x: src.x, y: src.y + src.h / 2 },
        { x: src.x, y: bottom },
        { x: dst.x, y: bottom },
        { x: dst.x, y: dst.y + dst.h / 2 },
      ];
    }
  }

  // Forward edge: straight connection between node faces
  const exit  = tb ? { x: src.x, y: src.y + src.h / 2 } : { x: src.x + src.w / 2, y: src.y };
  const enter = tb ? { x: dst.x, y: dst.y - dst.h / 2 } : { x: dst.x - dst.w / 2, y: dst.y };
  return [exit, enter];
}

// ── Helpers ───────────────────────────────────────────────────

function avgPos(ids: string[], posMap: Map<string, number>): number {
  if (ids.length === 0) return 0;
  return ids.reduce((s, id) => s + (posMap.get(id) ?? 0), 0) / ids.length;
}
