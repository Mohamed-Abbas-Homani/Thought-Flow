import type { ChartGraph, ChartMeta, ChartNode, ChartEdge } from "./types";
import { parseMermaidLine } from "./mermaid";

const DEFAULT_META: ChartMeta = {
  type: "flowchart",
  title: "Untitled",
  direction: "vertical",
  version: "1.0",
};

export interface PartialChart {
  meta: ChartMeta;
  nodes: ChartNode[];
  edges: ChartEdge[];
}

function inferType(shape: string, text: string): string {
  if (shape === "stadium") {
    const t = text.toLowerCase();
    if (
      t === "end" ||
      t === "stop" ||
      t === "finish" ||
      t.startsWith("end ") ||
      t.endsWith(" end")
    ) {
      return "end";
    }
    return "start";
  }
  const MAP: Record<string, string> = {
    "rounded-rect": "action",
    rect: "action",
    diamond: "decision",
    parallelogram: "io",
    hexagon: "loop",
    cylinder: "datastore",
    "double-circle": "event",
    subroutine: "subprocess",
    flag: "milestone",
  };
  return MAP[shape] ?? "action";
}

/** Parse whatever Mermaid lines are available in the accumulated stream text.
 *  Returns null if nothing useful has arrived yet. */
export function parseStreamingChart(accumulated: string): PartialChart | null {
  const meta: ChartMeta = { ...DEFAULT_META };
  const nodeMap = new Map<string, ChartNode>();
  const edges: ChartEdge[] = [];
  const edgeSet = new Set<string>();

  for (const line of accumulated.split("\n")) {
    const {
      nodes,
      edges: lineEdges,
      title,
      direction,
    } = parseMermaidLine(line);

    if (title) meta.title = title;
    if (direction) meta.direction = direction;

    for (const n of nodes) {
      if (!n.text) continue;
      const existing = nodeMap.get(n.id);
      // Replace if new, or if the existing entry is a bare-id placeholder
      if (!existing || existing.text === n.id) {
        nodeMap.set(n.id, {
          id: n.id,
          text: n.text,
          type: inferType(n.shape, n.text),
          shape: n.shape || "rounded-rect",
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
      // Ensure bare-reference nodes exist with a placeholder (guard: valid id only)
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

  if (nodeMap.size === 0 && edges.length === 0) return null;
  return { meta, nodes: Array.from(nodeMap.values()), edges };
}

export function partialToGraph(partial: PartialChart): ChartGraph {
  return {
    meta: partial.meta,
    nodes: partial.nodes,
    edges: partial.edges,
    styles: { classes: {}, nodeStyles: {}, edgeStyles: {} },
    extensions: {},
  };
}
