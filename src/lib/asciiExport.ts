import type { ChartGraph } from "./chart/types";
import { computeLayout } from "../components/Flowchart/layout";

export function renderAscii(chart: ChartGraph): string {
  const layout = computeLayout(chart);
  if (layout.nodes.length === 0) return "";

  // Character dimensions in pixels (approximate for typical terminal fonts)
  const CHAR_W = 10;
  const CHAR_H = 20;

  // Find bounds
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  const nodes = layout.nodes.map(n => {
    const text = n.text.replace(/^["']|["']$/g, "").trim();
    // Calculate character dimensions based on text length
    const gw = Math.max(Math.round(n.w / CHAR_W), text.length + 4);
    const gh = Math.max(Math.round(n.h / CHAR_H), 3);
    const gx = Math.round((n.x - n.w / 2) / CHAR_W);
    const gy = Math.round((n.y - n.h / 2) / CHAR_H);
    
    minX = Math.min(minX, gx);
    minY = Math.min(minY, gy);
    maxX = Math.max(maxX, gx + gw);
    maxY = Math.max(maxY, gy + gh);
    return { ...n, text, gx, gy, gw, gh };
  });

  const edges = layout.edges.map(e => {
    const gPoints = e.points.map(p => {
      const gx = Math.round(p.x / CHAR_W);
      const gy = Math.round(p.y / CHAR_H);
      minX = Math.min(minX, gx);
      minY = Math.min(minY, gy);
      maxX = Math.max(maxX, gx);
      maxY = Math.max(maxY, gy);
      return { gx, gy };
    });
    return { ...e, gPoints };
  });

  // Offset all coordinates to positive space
  const offsetX = -minX + 2;
  const offsetY = -minY + 2;
  const width = maxX - minX + 6;
  const height = maxY - minY + 4;

  const grid: string[][] = Array.from({ length: height }, () => Array(width).fill(" "));

  function set(x: number, y: number, char: string) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      grid[y][x] = char;
    }
  }

  // Draw Edges first
  for (const edge of edges) {
    for (let i = 0; i < edge.gPoints.length - 1; i++) {
      const p1 = edge.gPoints[i];
      const p2 = edge.gPoints[i + 1];
      
      let curX = p1.gx + offsetX;
      let curY = p1.gy + offsetY;
      const targetX = p2.gx + offsetX;
      const targetY = p2.gy + offsetY;

      // Simple Manhattan routing (horizontal then vertical)
      while (curX !== targetX) {
        set(curX, curY, "-");
        curX += targetX > curX ? 1 : -1;
      }
      while (curY !== targetY) {
        if (grid[curY][curX] === "-") set(curX, curY, "+");
        else set(curX, curY, "|");
        curY += targetY > curY ? 1 : -1;
      }
    }
    
    // Draw arrowhead
    const last = edge.gPoints[edge.gPoints.length - 1];
    const prev = edge.gPoints[edge.gPoints.length - 2] || last;
    const ax = last.gx + offsetX;
    const ay = last.gy + offsetY;
    if (last.gy > prev.gy) set(ax, ay, "v");
    else if (last.gy < prev.gy) set(ax, ay, "^");
    else if (last.gx > prev.gx) set(ax, ay, ">");
    else if (last.gx < prev.gx) set(ax, ay, "<");

    // Draw edge label if exists
    if (edge.label && edge.gPoints.length >= 2) {
      const mid = edge.gPoints[Math.floor(edge.gPoints.length / 2)];
      const lx = mid.gx + offsetX + 1;
      const ly = mid.gy + offsetY;
      for (let j = 0; j < edge.label.length; j++) {
        set(lx + j, ly, edge.label[j]);
      }
    }
  }

  // Draw Nodes
  for (const node of nodes) {
    const x = node.gx + offsetX;
    const y = node.gy + offsetY;
    const w = node.gw;
    const h = node.gh;
    const text = node.text;

    // Draw Node as Standard Rectangle
    for (let i = 0; i < w; i++) {
      set(x + i, y, "-");
      set(x + i, y + h - 1, "-");
    }
    for (let j = 0; j < h; j++) {
      set(x, y + j, "|");
      set(x + w - 1, y + j, "|");
    }
    set(x, y, "+");
    set(x + w - 1, y, "+");
    set(x, y + h - 1, "+");
    set(x + w - 1, y + h - 1, "+");
    
    // Content (centered)
    const startX = x + Math.floor((w - text.length) / 2);
    const startY = y + Math.floor(h / 2);
    for (let i = 0; i < text.length; i++) set(startX + i, startY, text[i]);
  }

  // Add Chart Title at the top
  if (chart.meta.title) {
    const title = chart.meta.title.toUpperCase();
    const tx = Math.floor((width - title.length) / 2);
    for (let i = 0; i < title.length; i++) set(tx + i, 0, title[i]);
  }

  return grid.map(line => line.join("").trimEnd()).join("\n");
}
