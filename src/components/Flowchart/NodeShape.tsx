import type { LayoutNode } from "./layout";

// ── Text wrapping ─────────────────────────────────────────────

function wrapText(text: string, maxW: number): string[] {
  const AVG_CH = 7.5;
  const perLine = Math.floor(maxW / AVG_CH);
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";

  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length > perLine && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function NodeText({ text, maxW, cx = 0, cy = 0 }: { text: string; maxW: number; cx?: number; cy?: number }) {
  const lines  = wrapText(text, maxW);
  const lh     = 16;
  const startY = cy - ((lines.length - 1) * lh) / 2;
  return (
    <>
      {lines.map((line, i) => (
        <text
          key={i}
          x={cx}
          y={startY + i * lh}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontFamily="inherit"
          fill="currentColor"
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {line}
        </text>
      ))}
    </>
  );
}

// ── Shape paths ───────────────────────────────────────────────

type ShapeProps = { w: number; h: number; className?: string };

function Rect({ w, h, className }: ShapeProps) {
  return <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} className={className} />;
}

function RoundedRect({ w, h, className }: ShapeProps) {
  return <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} className={className} />;
}

function Diamond({ w, h, className }: ShapeProps) {
  const hw = w / 2, hh = h / 2;
  return <polygon points={`0,${-hh} ${hw},0 0,${hh} ${-hw},0`} className={className} />;
}

function Parallelogram({ w, h, className }: ShapeProps) {
  const sk = 14, hw = w / 2, hh = h / 2;
  return (
    <polygon
      points={`${-hw + sk},${-hh} ${hw + sk},${-hh} ${hw - sk},${hh} ${-hw - sk},${hh}`}
      className={className}
    />
  );
}

function Hexagon({ w, h, className }: ShapeProps) {
  const hw = w / 2, hh = h / 2, indent = hh * 0.6;
  return (
    <polygon
      points={`${-hw + indent},${-hh} ${hw - indent},${-hh} ${hw},0 ${hw - indent},${hh} ${-hw + indent},${hh} ${-hw},0`}
      className={className}
    />
  );
}

function Subroutine({ w, h, className }: ShapeProps) {
  const hw = w / 2, hh = h / 2, inner = 10;
  return (
    <>
      <rect x={-hw} y={-hh} width={w} height={h} rx={3} className={className} />
      <line x1={-hw + inner} y1={-hh} x2={-hw + inner} y2={hh} className={className} strokeWidth={1} fill="none" />
      <line x1={hw - inner}  y1={-hh} x2={hw - inner}  y2={hh} className={className} strokeWidth={1} fill="none" />
    </>
  );
}

function Cylinder({ w, h, className }: ShapeProps) {
  const hw = w / 2, hh = h / 2, ey = 10;
  return (
    <>
      <rect x={-hw} y={-hh + ey} width={w} height={h - ey} className={className} />
      <ellipse cx={0} cy={-hh + ey} rx={hw} ry={ey} className={className} />
      <ellipse cx={0} cy={hh}       rx={hw} ry={ey} className={className} />
    </>
  );
}

function DoubleCircle({ w, h, className }: ShapeProps) {
  const r = Math.min(w, h) / 2;
  return (
    <>
      <circle cx={0} cy={0} r={r}     className={className} />
      <circle cx={0} cy={0} r={r - 5} className={className} />
    </>
  );
}

function Flag({ w, h, className }: ShapeProps) {
  const hw = w / 2, hh = h / 2, tip = hh * 0.7;
  return (
    <polygon
      points={`${-hw},${-hh} ${hw - tip},${-hh} ${hw},0 ${hw - tip},${hh} ${-hw},${hh}`}
      className={className}
    />
  );
}

function Stadium({ w, h, className }: ShapeProps) {
  return <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} className={className} />;
}

// ── Node colour classes ───────────────────────────────────────

function nodeClass(type: string): string {
  switch (type) {
    case "start":
    case "end":       return "fill-secondary stroke-ring";
    case "decision":  return "fill-transparent stroke-ring";
    case "io":        return "fill-primary stroke-border";
    default:          return "fill-primary stroke-border";
  }
}

function textClass(type: string): string {
  switch (type) {
    case "start":
    case "end":      return "text-foreground";
    case "decision": return "text-[color:var(--ring)]";
    default:         return "text-foreground/80";
  }
}

// ── Main component ────────────────────────────────────────────

interface NodeShapeProps {
  node: LayoutNode;
  focused?: boolean;
}

export function NodeShape({ node, focused }: NodeShapeProps) {
  const { x, y, w, h, shape, type, text } = node;
  const cls     = `${nodeClass(type)} stroke-[1.5px]`;
  const textPad = shape === "parallelogram" ? w - 30 : w - 16;

  const shapeEl = (() => {
    switch (shape) {
      case "rounded-rect":  return <RoundedRect  w={w} h={h} className={cls} />;
      case "diamond":       return <Diamond       w={w} h={h} className={cls} />;
      case "parallelogram": return <Parallelogram w={w} h={h} className={cls} />;
      case "hexagon":       return <Hexagon       w={w} h={h} className={cls} />;
      case "subroutine":    return <Subroutine    w={w} h={h} className={cls} />;
      case "cylinder":      return <Cylinder      w={w} h={h} className={cls} />;
      case "double-circle": return <DoubleCircle  w={w} h={h} className={cls} />;
      case "flag":          return <Flag          w={w} h={h} className={cls} />;
      case "stadium":       return <Stadium       w={w} h={h} className={cls} />;
      default:              return <Rect          w={w} h={h} className={cls} />;
    }
  })();

  return (
    <g
      style={{
        transform:  `translate(${x}px, ${y}px)`,
        transition: "transform 0.35s cubic-bezier(0.4,0,0.2,1)",
      }}
      className={textClass(type)}
    >
      {focused && (
        <rect
          x={-w / 2 - 6} y={-h / 2 - 6}
          width={w + 12}  height={h + 12}
          rx={10}
          fill="none"
          stroke="var(--ring)"
          strokeWidth={2}
          strokeDasharray="5 3"
          opacity={0.75}
        />
      )}
      {shapeEl}
      <NodeText text={text} maxW={textPad} />
    </g>
  );
}
