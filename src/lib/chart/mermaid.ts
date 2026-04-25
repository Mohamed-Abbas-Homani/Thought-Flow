import type { ChartGraph, ChartNode, ChartEdge, ChartMeta } from "./types";

// ─── Shape encoding ───────────────────────────────────────────────────────────

const SHAPE_OPEN: Record<string, string> = {
  "stadium":      "([",
  "rounded-rect": "(",
  "rect":         "[",
  "diamond":      "{",
  "hexagon":      "{{",
  "cylinder":     "[(",
  "double-circle":"((",
  "subroutine":   "[[",
  "flag":         ">",
  "parallelogram":"[/",
};

const SHAPE_CLOSE: Record<string, string> = {
  "stadium":      "])",
  "rounded-rect": ")",
  "rect":         "]",
  "diamond":      "}",
  "hexagon":      "}}",
  "cylinder":     ")]",
  "double-circle":"))",
  "subroutine":   "]]",
  "flag":         "]",
  "parallelogram":"/]",
};

// Ordered from most-specific to least-specific (longer delimiters first)
const NODE_PATTERNS: { open: string; close: string; shape: string }[] = [
  { open: "([",  close: "])",  shape: "stadium"       },
  { open: "[(", close: ")]",  shape: "cylinder"       },
  { open: "((", close: "))",  shape: "double-circle"  },
  { open: "[[", close: "]]",  shape: "subroutine"     },
  { open: "{{", close: "}}",  shape: "hexagon"        },
  { open: "{",  close: "}",   shape: "diamond"        },
  { open: "[/", close: "/]",  shape: "parallelogram"  },
  { open: ">",  close: "]",   shape: "flag"           },
  { open: "(",  close: ")",   shape: "rounded-rect"   },
  { open: "[",  close: "]",   shape: "rect"           },
];

const SHAPE_TO_TYPE: Record<string, string> = {
  "stadium":       "start",   // overridden to "end" when text looks like end
  "rounded-rect":  "action",
  "rect":          "action",
  "diamond":       "decision",
  "parallelogram": "io",
  "hexagon":       "loop",
  "cylinder":      "datastore",
  "double-circle": "event",
  "subroutine":    "subprocess",
  "flag":          "milestone",
};

function inferType(shape: string, text: string): string {
  if (shape === "stadium") {
    const t = text.toLowerCase();
    if (t === "end" || t === "stop" || t === "finish" || t.startsWith("end ") || t.endsWith(" end")) {
      return "end";
    }
    return "start";
  }
  return SHAPE_TO_TYPE[shape] ?? "action";
}

function stripOuterQuotes(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function mermaidText(text: string): string {
  return `"${stripOuterQuotes(text).replace(/"/g, "'")}"`;
}

// ─── Edge encoding ────────────────────────────────────────────────────────────

function edgeArrow(style: ChartEdge["style"]): string {
  if (style === "dotted") return "-.->";
  if (style === "thick")  return "==>";
  return "-->";
}

function parseArrow(arrow: string): ChartEdge["style"] {
  if (arrow.startsWith("="))  return "thick";
  if (arrow.startsWith("-.-")) return "dotted";
  return "solid";
}

// ─── Parse a node inline definition like: n1([text]) ────────────────────────

function parseInlineNode(segment: string): { id: string; text: string; shape: string } | null {
  const seg = segment.trim();
  const idMatch = seg.match(/^([A-Za-z_][\w]*)/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const rest = seg.slice(id.length).trim();

  for (const { open, close, shape } of NODE_PATTERNS) {
    if (rest.startsWith(open) && rest.endsWith(close)) {
      const inner = stripOuterQuotes(rest.slice(open.length, rest.length - close.length));
      return { id, text: inner, shape };
    }
  }

  // Bare identifier (no shape brackets) — treat as reference only
  if (rest === "" || rest.startsWith("-->") || rest.startsWith("-.->") || rest.startsWith("==>")) {
    return null; // not a definition
  }
  return null;
}

// ─── Parse one Mermaid line ───────────────────────────────────────────────────

// Returns { nodes, edges } extracted from this line (may be empty).
// Handles:
//   n1[text]              — node definition
//   n1[text] --> n2[text] — edge with optional inline defs
//   n1 --> n2             — bare edge
//   n1 -->|label| n2      — labeled edge

interface LineResult {
  nodes: Array<{ id: string; text: string; shape: string }>;
  edges: Array<{ from: string; to: string; style: ChartEdge["style"]; label: string }>;
  title?: string;
  direction?: "vertical" | "horizontal";
  nodeClass?: { id: string; className: string };
}

export function parseMermaidLine(line: string): LineResult {
  const result: LineResult = { nodes: [], edges: [] };
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("%%") || trimmed.startsWith("graph ")) {
    if (trimmed.startsWith("graph ")) {
      result.direction = "vertical"; // LR/RL disabled — always top-down
    }
    return result;
  }

  if (trimmed.startsWith("title:")) {
    result.title = trimmed.slice(6).trim();
    return result;
  }

  if (trimmed.startsWith("class ")) {
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 3) {
      result.nodeClass = { id: parts[1], className: parts[2] };
    }
    return result;
  }

  // Try to parse as an edge line (contains --> or -.-> or ==>)
  const arrowRe = /(-->|-\.->|==>)/;
  const arrowMatch = trimmed.match(arrowRe);

  if (arrowMatch && arrowMatch.index !== undefined) {
    const arrowIndex = arrowMatch.index;
    const lhs = trimmed.slice(0, arrowIndex).trim();
    const afterArrow = trimmed.slice(arrowIndex + arrowMatch[0].length).trim();
    const style = parseArrow(arrowMatch[0]);

    // Extract label if present: -->|label| rhs
    let label = "";
    let rhs = afterArrow;
    if (afterArrow.startsWith("|")) {
      const closePipe = afterArrow.indexOf("|", 1);
      if (closePipe !== -1) {
        label = stripOuterQuotes(afterArrow.slice(1, closePipe));
        rhs = afterArrow.slice(closePipe + 1).trim();
      }
    }

    // Parse LHS node (may be bare id or inline def)
    const lhsNode = parseInlineNode(lhs) ?? { id: lhs, text: "", shape: "" };
    if (lhsNode.text) result.nodes.push(lhsNode);

    // RHS may chain multiple edges; for now extract just the first node
    // Stop at the next arrow
    const nextArrow = rhs.match(arrowRe);
    const rhsSegment = nextArrow?.index !== undefined ? rhs.slice(0, nextArrow.index).trim() : rhs;
    const rhsNode = parseInlineNode(rhsSegment) ?? { id: rhsSegment.trim(), text: "", shape: "" };
    if (rhsNode.text) result.nodes.push(rhsNode);

    const fromId = lhsNode.id;
    const toId = rhsNode.id;
    // Only accept valid Mermaid identifiers — rejects partial-stream artifacts like "|"
    const validId = /^[A-Za-z_][\w]*$/;
    if (validId.test(fromId) && validId.test(toId)) {
      result.edges.push({ from: fromId, to: toId, style, label });
    }

    // Handle chained edges: n1 --> n2 --> n3
    if (nextArrow?.index !== undefined) {
      const chained = parseMermaidLine(`${rhsSegment}${rhs.slice(nextArrow.index)}`);
      result.nodes.push(...chained.nodes);
      result.edges.push(...chained.edges);
    }

    return result;
  }

  // No arrow — try pure node definition
  const nodeDef = parseInlineNode(trimmed);
  if (nodeDef) result.nodes.push(nodeDef);

  return result;
}

// ─── mermaidToChart ───────────────────────────────────────────────────────────

export function mermaidToChart(text: string): ChartGraph {
  const meta: ChartMeta = {
    type: "flowchart",
    title: "Untitled",
    direction: "vertical",
    version: "1.0",
  };

  const nodeMap = new Map<string, ChartNode>();
  const edges: ChartEdge[] = [];
  const edgeSet = new Set<string>();

  for (const line of text.split("\n")) {
    const { nodes, edges: lineEdges, title, direction } = parseMermaidLine(line);
    if (nodes.length > 0 || lineEdges.length > 0) {
      console.log(`[mermaid] line "${line.slice(0, 60)}" → ${nodes.length} node(s), ${lineEdges.length} edge(s)`);
    }

    if (title) meta.title = title;
    if (direction) meta.direction = direction;

    const { nodeClass } = parseMermaidLine(line);
    if (nodeClass) {
      const existing = nodeMap.get(nodeClass.id);
      if (existing) {
        existing.styleClass = nodeClass.className;
      }
    }

    for (const n of nodes) {
      if (!n.text) continue;
      const existing = nodeMap.get(n.id);
      if (!existing || existing.text === n.id) {
        nodeMap.set(n.id, {
          id: n.id,
          text: n.text,
          type: inferType(n.shape, n.text),
          shape: n.shape,
          styleClass: null,
          metadata: {},
        });
      }
    }

    for (const e of lineEdges) {
      const key = `${e.from}→${e.to}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({
          from: e.from,
          to: e.to,
          type: e.label ? "conditional" : "sequential",
          label: e.label,
          style: e.style,
          metadata: {},
        });
      }

      // Ensure bare-reference nodes exist (guard: valid id only)
      const validId = /^[A-Za-z_][\w]*$/;
      for (const id of [e.from, e.to]) {
        if (validId.test(id) && !nodeMap.has(id)) {
          nodeMap.set(id, {
            id,
            text: id,
            type: "action",
            shape: "rounded-rect",
            styleClass: null,
            metadata: {},
          });
        }
      }
    }
  }

  return {
    meta,
    nodes: Array.from(nodeMap.values()),
    edges,
    styles: { classes: {}, nodeStyles: {}, edgeStyles: {} },
    extensions: {},
  };
}

// ─── chartToMermaid ───────────────────────────────────────────────────────────

export function chartToMermaid(chart: ChartGraph): string {
  const lines: string[] = [
    "graph TD",
    `title: ${chart.meta.title}`,
  ];

  for (const node of chart.nodes) {
    const open  = SHAPE_OPEN[node.shape]  ?? "[";
    const close = SHAPE_CLOSE[node.shape] ?? "]";
    const text  = mermaidText(node.text);
    lines.push(`${node.id}${open}${text}${close}`);
  }

  for (const edge of chart.edges) {
    const arrow = edgeArrow(edge.style);
    const label = edge.label ? `|${stripOuterQuotes(edge.label)}|` : "";
    lines.push(`${edge.from} ${arrow}${label} ${edge.to}`);
  }

  return lines.join("\n");
}

export interface MermaidThemeTokens {
  chartBg: string;
  chartNodeBg: string;
  chartNodeBorder: string;
  chartEdge: string;
  chartText: string;
}

function quoteInitValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function chartToClipboardMermaid(chart: ChartGraph, theme?: MermaidThemeTokens): string {
  const lines = chartToMermaid(chart)
    .split("\n")
    .filter((line) => !line.startsWith("title:"));

  if (!theme) return lines.join("\n");

  const init = [
    `%%{init: {"theme": "base", "themeVariables": {`,
    `"background": "${quoteInitValue(theme.chartBg)}", `,
    `"primaryColor": "${quoteInitValue(theme.chartNodeBg)}", `,
    `"primaryTextColor": "${quoteInitValue(theme.chartText)}", `,
    `"primaryBorderColor": "${quoteInitValue(theme.chartNodeBorder)}", `,
    `"lineColor": "${quoteInitValue(theme.chartEdge)}", `,
    `"nodeTextColor": "${quoteInitValue(theme.chartText)}"`,
    `}}}%%`,
  ].join("");

  const styledLines = [init, ...lines];
  for (const node of chart.nodes) {
    styledLines.push(
      `style ${node.id} fill:${theme.chartNodeBg},stroke:${theme.chartNodeBorder},color:${theme.chartText}`
    );
  }
  chart.edges.forEach((_, index) => {
    styledLines.push(`linkStyle ${index} stroke:${theme.chartEdge},color:${theme.chartText}`);
  });

  return styledLines.join("\n");
}
