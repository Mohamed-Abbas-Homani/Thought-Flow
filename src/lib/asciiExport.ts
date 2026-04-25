import type { ChartGraph } from "./chart/types";
import { computeLayout } from "../components/Flowchart/layout";

interface GridNode {
  id: string;
  text: string;
  shape: string;
  type: string;
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
}

interface RenderOptions {
  color?: boolean;
}

const RESET = "\x1b[0m";
const SHAPE_COLORS: Record<string, string> = {
  stadium: "\x1b[38;5;81m",
  diamond: "\x1b[38;5;221m",
  parallelogram: "\x1b[38;5;147m",
  hexagon: "\x1b[38;5;114m",
  cylinder: "\x1b[38;5;175m",
  "double-circle": "\x1b[38;5;209m",
  subroutine: "\x1b[38;5;110m",
  flag: "\x1b[38;5;203m",
  "rounded-rect": "\x1b[38;5;250m",
  rect: "\x1b[38;5;250m",
};

function cleanText(text: string) {
  return text
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(text: string, maxWidth = 26) {
  const words = cleanText(text).split(" ").filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const chunks =
      word.length > maxWidth
        ? (word.match(new RegExp(`.{1,${maxWidth}}`, "g")) ?? [word])
        : [word];
    for (const chunk of chunks) {
      const next = line ? `${line} ${chunk}` : chunk;
      if (next.length <= maxWidth || !line) {
        line = next;
      } else {
        lines.push(line);
        line = chunk;
      }
    }
  }

  if (line) lines.push(line);
  return lines;
}

function borderFor(shape: string) {
  if (shape === "diamond")
    return { tl: "/", tr: "\\", bl: "\\", br: "/", h: "-", v: "|" };
  if (shape === "stadium" || shape === "rounded-rect")
    return { tl: "(", tr: ")", bl: "(", br: ")", h: "-", v: "|" };
  if (shape === "cylinder")
    return { tl: "(", tr: ")", bl: "(", br: ")", h: "=", v: "|" };
  if (shape === "hexagon")
    return { tl: "<", tr: ">", bl: "<", br: ">", h: "-", v: "|" };
  if (shape === "double-circle")
    return { tl: "o", tr: "o", bl: "o", br: "o", h: "=", v: "|" };
  if (shape === "subroutine")
    return { tl: "+", tr: "+", bl: "+", br: "+", h: "=", v: "|" };
  return { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" };
}

function buildNodes(chart: ChartGraph): GridNode[] {
  const layout = computeLayout(chart);
  const minLayoutX = Math.min(...layout.nodes.map((node) => node.x));
  const rawNodes = layout.nodes.map((node) => {
    const lines = wrapText(node.text);
    const textWidth = Math.max(...lines.map((line) => line.length), 0);
    return {
      id: node.id,
      text: cleanText(node.text),
      shape: node.shape,
      type: node.type,
      sourceX: node.x,
      sourceY: node.y,
      x: 0,
      y: 0,
      w: Math.max(12, Math.min(34, textWidth + 4)),
      h: Math.max(3, lines.length + 2),
      lines,
    };
  });

  const rows: GridNode[][] = [];
  for (const node of rawNodes.sort(
    (a, b) => a.sourceY - b.sourceY || a.sourceX - b.sourceX,
  )) {
    const row = rows.find(
      (items) => Math.abs(items[0].sourceY - node.sourceY) < 80,
    );
    if (row) row.push(node);
    else rows.push([node]);
  }

  let y = 3;
  for (const row of rows) {
    row.sort((a, b) => a.sourceX - b.sourceX);
    let cursor = 4;
    const rowHeight = Math.max(...row.map((node) => node.h));

    for (const node of row) {
      const projectedX = Math.round((node.sourceX - minLayoutX) / 5.5) + 4;
      node.x = Math.max(cursor, projectedX);
      node.y = y + Math.floor((rowHeight - node.h) / 2);
      cursor = node.x + node.w + 16;
    }

    y += rowHeight + 7;
  }

  return rawNodes;
}

export function renderAscii(
  chart: ChartGraph,
  options: RenderOptions = {},
): string {
  const nodes = buildNodes(chart);
  if (nodes.length === 0) return "";

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const title =
    chart.meta.title && chart.meta.title !== "Untitled"
      ? chart.meta.title.toUpperCase()
      : "";
  const titleWidth = title ? title.length + 4 : 0;
  const width =
    Math.max(titleWidth, ...nodes.map((node) => node.x + node.w + 8)) + 8;
  const edgeDrop = 8;
  const height = Math.max(...nodes.map((node) => node.y + node.h + edgeDrop));
  const grid: string[][] = Array.from({ length: height }, () =>
    Array(width).fill(" "),
  );
  const colorGrid: (string | null)[][] = Array.from({ length: height }, () =>
    Array(width).fill(null),
  );

  function set(
    x: number,
    y: number,
    char: string,
    color: string | null = null,
  ) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const existing = grid[y][x];
    grid[y][x] =
      existing !== " " &&
      existing !== char &&
      "-|".includes(existing) &&
      "-|".includes(char)
        ? "+"
        : char;
    if (color) colorGrid[y][x] = color;
  }

  function drawH(x1: number, x2: number, y: number) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) set(x, y, "-");
  }

  function drawV(x: number, y1: number, y2: number) {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) set(x, y, "|");
  }

  function drawLabel(label: string, x: number, y: number) {
    const text = cleanText(label).slice(0, 18);
    const labelX = Math.max(0, Math.min(width - text.length, x));
    for (let i = 0; i < text.length; i++) set(labelX + i, y, text[i]);
  }

  if (title) {
    const x = Math.max(0, Math.floor((width - title.length) / 2));
    for (let i = 0; i < title.length; i++) set(x + i, 0, title[i]);
  }

  for (const edge of chart.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;

    const startX = from.x + Math.floor(from.w / 2);
    const startY = from.y + from.h;
    const endX = to.x + Math.floor(to.w / 2);
    const endY = Math.max(0, to.y - 1);
    const fromRow = from.y;
    const toRow = to.y;
    const label = edge.label ? cleanText(edge.label) : "";

    if (toRow <= fromRow) {
      const right = Math.max(from.x + from.w, to.x + to.w) + 6;
      const laneX = Math.min(width - 2, right);
      const laneY = Math.min(height - 2, startY + 3);
      drawV(startX, startY, laneY);
      drawH(startX, laneX, laneY);
      drawV(laneX, Math.min(laneY, endY), Math.max(laneY, endY));
      drawH(laneX, endX, endY);
      set(endX, endY, "v");
      if (label)
        drawLabel(
          label,
          Math.min(laneX + 2, width - label.length),
          Math.max(0, laneY - 1),
        );
      continue;
    }

    const midY = Math.min(
      height - 2,
      startY + Math.max(3, Math.floor((endY - startY) / 2)),
    );

    drawV(startX, startY, midY);
    drawH(startX, endX, midY);
    drawV(endX, midY, endY);
    set(endX, endY, "v");

    if (label)
      drawLabel(
        label,
        Math.floor((startX + endX - label.length) / 2),
        Math.max(0, midY - 1),
      );
  }

  for (const node of nodes) {
    const color = options.color
      ? (SHAPE_COLORS[node.shape] ?? SHAPE_COLORS.rect)
      : null;
    const border = borderFor(node.shape);
    const right = node.x + node.w - 1;
    const bottom = node.y + node.h - 1;

    for (let x = node.x + 1; x < right; x++) {
      set(x, node.y, border.h, color);
      set(x, bottom, border.h, color);
    }
    for (let y = node.y + 1; y < bottom; y++) {
      set(node.x, y, border.v, color);
      set(right, y, border.v, color);
    }

    set(node.x, node.y, border.tl, color);
    set(right, node.y, border.tr, color);
    set(node.x, bottom, border.bl, color);
    set(right, bottom, border.br, color);

    const firstLineY = node.y + Math.floor((node.h - node.lines.length) / 2);
    for (let lineIndex = 0; lineIndex < node.lines.length; lineIndex++) {
      const line = node.lines[lineIndex];
      const textX = node.x + Math.floor((node.w - line.length) / 2);
      for (let i = 0; i < line.length; i++)
        set(textX + i, firstLineY + lineIndex, line[i], color);
    }
  }

  return grid
    .map((line, y) => {
      let activeColor: string | null = null;
      let out = "";
      for (let x = 0; x < line.length; x++) {
        const color = options.color ? colorGrid[y][x] : null;
        if (color !== activeColor) {
          if (activeColor) out += RESET;
          if (color) out += color;
          activeColor = color;
        }
        out += line[x];
      }
      if (activeColor) out += RESET;
      return out.replace(/\s+$/g, "");
    })
    .join("\n");
}
