import type { LayoutEdge } from "./layout";

type Point = { x: number; y: number };

// ── Bezier path through waypoints ─────────────────────────────

function pointsToPath(pts: Point[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    const [a, b] = pts;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const vertical = Math.abs(dy) >= Math.abs(dx);
    const c1 = vertical
      ? { x: a.x, y: a.y + dy * 0.45 }
      : { x: a.x + dx * 0.45, y: a.y };
    const c2 = vertical
      ? { x: b.x, y: b.y - dy * 0.45 }
      : { x: b.x - dx * 0.45, y: b.y };
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
  }

  let d = `M ${pts[0].x} ${pts[0].y}`;

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const smoothing = 0.18;
    const cp1 = {
      x: p1.x + (p2.x - p0.x) * smoothing,
      y: p1.y + (p2.y - p0.y) * smoothing,
    };
    const cp2 = {
      x: p2.x - (p3.x - p1.x) * smoothing,
      y: p2.y - (p3.y - p1.y) * smoothing,
    };
    d += ` C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${p2.x} ${p2.y}`;
  }

  return d;
}

// ── Arrowhead at end of path ──────────────────────────────────

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function trimEnd(points: Point[], amount: number): Point[] {
  if (points.length < 2 || amount <= 0) return points;
  const pts = [...points];
  let remaining = amount;

  for (let i = pts.length - 1; i > 0; i--) {
    const end = pts[i];
    const prev = pts[i - 1];
    const len = distance(prev, end);
    if (len <= remaining) {
      pts.pop();
      remaining -= len;
      continue;
    }

    const t = (len - remaining) / len;
    pts[i] = {
      x: prev.x + (end.x - prev.x) * t,
      y: prev.y + (end.y - prev.y) * t,
    };
    return pts;
  }

  return points;
}

function arrowTip(end: Point, prev: Point, size = 10): string {
  const angle  = Math.atan2(end.y - prev.y, end.x - prev.x);
  const spread = Math.PI / 8;
  const l1x = end.x - size * Math.cos(angle - spread);
  const l1y = end.y - size * Math.sin(angle - spread);
  const l2x = end.x - size * Math.cos(angle + spread);
  const l2y = end.y - size * Math.sin(angle + spread);
  return `M ${end.x} ${end.y} L ${l1x} ${l1y} L ${l2x} ${l2y} Z`;
}

// ── Edge label midpoint ───────────────────────────────────────

function midpoint(pts: Point[]): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0];

  const lengths = pts.slice(1).map((p, i) => distance(pts[i], p));
  const total = lengths.reduce((sum, len) => sum + len, 0);
  let travelled = 0;

  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    if (travelled + len >= total / 2) {
      const a = pts[i];
      const b = pts[i + 1];
      const t = len === 0 ? 0 : (total / 2 - travelled) / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    travelled += len;
  }

  return pts[Math.floor(pts.length / 2)];
}

// ── Stroke style ──────────────────────────────────────────────

function strokeProps(style: LayoutEdge["style"]): { strokeDasharray?: string; strokeWidth: number; arrowSize: number } {
  switch (style) {
    case "dotted": return { strokeDasharray: "5 5", strokeWidth: 1.7, arrowSize: 10 };
    case "thick":  return { strokeWidth: 2.8, arrowSize: 12 };
    case "open":   return { strokeWidth: 1.7, arrowSize: 0 };
    default:       return { strokeWidth: 1.7, arrowSize: 10 };
  }
}

// ── Component ─────────────────────────────────────────────────

export function EdgePath({ edge }: { edge: LayoutEdge }) {
  const { points, style, label, isBack } = edge;
  if (points.length < 2) return null;

  const { strokeDasharray, strokeWidth, arrowSize } = strokeProps(style);
  const visiblePoints = style === "open" ? points : trimEnd(points, arrowSize * 0.72);
  const pathD  = pointsToPath(visiblePoints);
  const arrowD = style === "open"
    ? ""
    : arrowTip(points[points.length - 1], visiblePoints[visiblePoints.length - 1], arrowSize);
  const mid = midpoint(points);

  const stroke        = "var(--chart-edge)";
  const strokeOpacity = isBack ? 0.6 : 1;

  return (
    <g style={{ transition: "opacity 0.35s ease-out" }}>
      <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {arrowD && (
        <path
          d={arrowD}
          fill={stroke}
          stroke={stroke}
          strokeOpacity={strokeOpacity}
          fillOpacity={strokeOpacity}
          strokeWidth={0}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {label && (
        <g transform={`translate(${mid.x}, ${mid.y})`}>
          <rect
            x={-label.length * 3.4 - 7} y={-10}
            width={label.length * 6.8 + 14} height={20}
            rx={5}
            fill="var(--chart-bg)"
            stroke="var(--chart-node-border)"
            strokeWidth={0.75}
            opacity={0.94}
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fill="var(--chart-text)"
            style={{ userSelect: "none", pointerEvents: "none" }}
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
}
