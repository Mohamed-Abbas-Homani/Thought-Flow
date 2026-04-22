import type { LayoutEdge } from "./layout";

// ── Bezier path through waypoints ─────────────────────────────

function pointsToPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    const [a, b] = pts;
    const dy = (b.y - a.y) * 0.5;
    const dx = (b.x - a.x) * 0.5;
    return `M ${a.x} ${a.y} C ${a.x + dx * 0.3} ${a.y + dy} ${b.x - dx * 0.3} ${b.y - dy} ${b.x} ${b.y}`;
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 2)];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const p3 = pts[Math.min(pts.length - 1, i + 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

// ── Arrowhead at end of path ──────────────────────────────────

function arrowTip(pts: { x: number; y: number }[], size = 8): string {
  if (pts.length < 2) return "";
  const end    = pts[pts.length - 1];
  const prev   = pts[pts.length - 2];
  const angle  = Math.atan2(end.y - prev.y, end.x - prev.x);
  const spread = Math.PI / 7;
  const l1x = end.x - size * Math.cos(angle - spread);
  const l1y = end.y - size * Math.sin(angle - spread);
  const l2x = end.x - size * Math.cos(angle + spread);
  const l2y = end.y - size * Math.sin(angle + spread);
  return `M ${l1x} ${l1y} L ${end.x} ${end.y} L ${l2x} ${l2y}`;
}

// ── Edge label midpoint ───────────────────────────────────────

function midpoint(pts: { x: number; y: number }[]): { x: number; y: number } {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0];
  const mid = Math.floor(pts.length / 2);
  if (pts.length % 2 === 0) {
    return { x: (pts[mid - 1].x + pts[mid].x) / 2, y: (pts[mid - 1].y + pts[mid].y) / 2 };
  }
  return pts[mid];
}

// ── Stroke style ──────────────────────────────────────────────

function strokeProps(style: LayoutEdge["style"]): { strokeDasharray?: string; strokeWidth: number } {
  switch (style) {
    case "dotted": return { strokeDasharray: "5 4", strokeWidth: 1.5 };
    case "thick":  return { strokeWidth: 2.5 };
    case "open":   return { strokeWidth: 1.5 };
    default:       return { strokeWidth: 1.5 };
  }
}

// ── Component ─────────────────────────────────────────────────

export function EdgePath({ edge }: { edge: LayoutEdge }) {
  const { points, style, label, isBack } = edge;
  if (points.length < 2) return null;

  const pathD  = pointsToPath(points);
  const arrowD = style === "open" ? "" : arrowTip(points);
  const { strokeDasharray, strokeWidth } = strokeProps(style);
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
          fill="none"
          stroke={stroke}
          strokeOpacity={strokeOpacity}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {label && (
        <g transform={`translate(${mid.x}, ${mid.y})`}>
          <rect
            x={-label.length * 3.5 - 4} y={-9}
            width={label.length * 7 + 8} height={18}
            rx={3}
            fill="var(--chart-bg)"
            stroke="var(--chart-node-border)"
            strokeWidth={0.5}
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
