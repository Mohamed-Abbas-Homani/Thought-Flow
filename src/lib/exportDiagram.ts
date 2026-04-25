import type { ChartGraph } from "./chart/types";
import { renderAscii } from "./asciiExport";

export type ExportFormat = "svg" | "html" | "png" | "pdf" | "ascii";

const STYLE_PROPS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "fill-opacity",
  "opacity",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
];

const SVG_NS = "http://www.w3.org/2000/svg";

interface RasterLabel {
  kind: "node" | "edge" | "text";
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  fontWeight: string;
  color: string;
}

function chartTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--chart-text").trim() || "#111111";
}

function cssColorToRgb(color: string): { r: number; g: number; b: number } | null {
  const value = color.trim();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split("").map((char) => char + char).join("")
      : hex[1];
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
    };
  }

  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) {
    return {
      r: Math.max(0, Math.min(255, Number.parseFloat(rgb[1]))),
      g: Math.max(0, Math.min(255, Number.parseFloat(rgb[2]))),
      b: Math.max(0, Math.min(255, Number.parseFloat(rgb[3]))),
    };
  }

  return null;
}

function luminance(color: { r: number; g: number; b: number }) {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(foreground: string, background: string) {
  const fg = cssColorToRgb(foreground);
  const bg = cssColorToRgb(background);
  if (!fg || !bg) return 21;

  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readableNodeTextColor() {
  const styles = getComputedStyle(document.documentElement);
  const preferred = chartTextColor();
  const nodeBg = styles.getPropertyValue("--chart-node-bg").trim() || "#ffffff";

  if (contrastRatio(preferred, nodeBg) >= 4.5) return preferred;
  return contrastRatio("#111111", nodeBg) >= contrastRatio("#ffffff", nodeBg) ? "#111111" : "#ffffff";
}

function safeName(name: string) {
  return name
    .trim()
    .replace(/["'`]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "thought-flow";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function standaloneHtml(title: string, svgXml: string, chart: ChartGraph | null) {
  const bodySvg = svgXml.replace(/^\s*<\?xml[^>]*>\s*/i, "");
  const styles = getComputedStyle(document.documentElement);
  const chartBg = styles.getPropertyValue("--chart-bg").trim() || "#ffffff";
  const chartNodeBg = styles.getPropertyValue("--chart-node-bg").trim() || "#ffffff";
  const chartNodeBorder = styles.getPropertyValue("--chart-node-border").trim() || "#999999";
  const chartEdge = styles.getPropertyValue("--chart-edge").trim() || "#666666";
  const chartText = styles.getPropertyValue("--chart-text").trim() || "#111111";
  const graphJson = JSON.stringify(chart ? { nodes: chart.nodes.map((node) => node.id), edges: chart.edges.map((edge) => ({ from: edge.from, to: edge.to })) } : { nodes: [], edges: [] }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --chart-bg: ${chartBg};
      --chart-node-bg: ${chartNodeBg};
      --chart-node-border: ${chartNodeBorder};
      --chart-edge: ${chartEdge};
      --chart-text: ${chartText};
    }

    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--chart-bg);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #stage {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      cursor: grab;
      touch-action: none;
      background: var(--chart-bg);
      position: relative;
    }

    #stage.dragging {
      cursor: grabbing;
    }

    svg {
      position: absolute;
      left: 0;
      top: 0;
      max-width: none;
      height: auto;
      transform-origin: 0 0;
      user-select: none;
      overflow: visible !important;
    }

    svg [data-node] text,
    svg .node text,
    svg .nodeLabel,
    svg .nodeLabel * {
      color: var(--chart-text) !important;
      fill: var(--chart-text) !important;
    }

    svg .export-active rect,
    svg .export-active polygon,
    svg .export-active circle,
    svg .export-active ellipse,
    svg .export-active path {
      stroke: var(--chart-text) !important;
      stroke-width: 4px !important;
      stroke-dasharray: 6 3;
      filter: drop-shadow(0 0 5px var(--chart-text));
    }

    svg * {
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.2s ease, filter 0.2s ease;
    }

    #controls {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 10;
      display: flex;
      gap: 6px;
      padding: 6px;
      border: 1px solid var(--chart-node-border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--chart-bg) 88%, transparent);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      backdrop-filter: blur(10px);
    }

    #controls button {
      min-width: 34px;
      height: 30px;
      border: 1px solid var(--chart-node-border);
      border-radius: 6px;
      background: var(--chart-node-bg);
      color: var(--chart-text);
      font: 600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }

    #controls button:hover {
      filter: brightness(1.15);
      border-color: var(--chart-text);
    }

    #controls button:active {
      filter: brightness(0.9);
      transform: translateY(1px);
    }

    #controls button.active {
      background: var(--chart-text);
      color: var(--chart-bg);
      border-color: var(--chart-text);
    }
  </style>
</head>
<body>
<div id="stage">
${bodySvg}
</div>
<div id="controls" aria-label="Playback controls">
  <button id="play" title="Start/Stop playback (Arrow keys to navigate)">Play</button>
</div>
<script>
(() => {
  const stage = document.getElementById("stage");
  const svg = stage?.querySelector("svg");
  if (!stage || !svg) return;
  const controls = {
    play: document.getElementById("play"),
  };
  const graph = ${graphJson};
  const nodes = graph.nodes
    .map((id) => svg.querySelector(\`[data-export-node-id="\${CSS.escape(id)}"], [data-node="\${CSS.escape(id)}"]\`))
    .filter(Boolean);
  const nodeIds = graph.nodes.filter((_, index) => nodes[index]);
  const edges = graph.edges;

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;
  let activeId = null;
  let activeIndex = -1;
  const chartTitle = "${escapeHtml(title)}";


  function svgSize() {
    const viewBox = svg.viewBox?.baseVal;
    const width = viewBox?.width || Number.parseFloat(svg.getAttribute("width") || "0") || 1000;
    const height = viewBox?.height || Number.parseFloat(svg.getAttribute("height") || "0") || 700;
    return { width, height };
  }

  function apply() {
    svg.style.transform = \`translate(\${tx}px, \${ty}px) scale(\${scale})\`;
  }

  function centerElement(el) {
    const stageRect = stage.getBoundingClientRect();
    const nodeRect = el.getBoundingClientRect();
    tx += stageRect.width / 2 - (nodeRect.left + nodeRect.width / 2);
    ty += stageRect.height / 2 - (nodeRect.top + nodeRect.height / 2);
    apply();
  }

  function setActiveByIndex(index) {
    if (nodes.length === 0) return;
    activeIndex = (index + nodes.length) % nodes.length;
    for (const node of nodes) node.classList.remove("export-active");
    const active = nodes[activeIndex];
    activeId = nodeIds[activeIndex] ?? null;
    active.classList.add("export-active");
    centerElement(active);
  }

  function setActiveById(id) {
    const index = nodeIds.indexOf(id);
    if (index >= 0) setActiveByIndex(index);
  }

  function startPlayMode() {
    if (activeIndex < 0) setActiveByIndex(0);
    controls.play.textContent = "Stop";
    controls.play.classList.add("active");
  }

  function stopPlayMode() {
    activeId = null;
    activeIndex = -1;
    for (const node of nodes) node.classList.remove("export-active");
    controls.play.textContent = "Play";
    controls.play.classList.remove("active");
  }

  function childIds(id) {
    return edges.filter((edge) => edge.from === id).map((edge) => edge.to);
  }

  function parentId(id) {
    return edges.find((edge) => edge.to === id)?.from ?? null;
  }

  function nextChild() {
    if (activeIndex < 0 || !activeId) return startPlayMode();
    const children = childIds(activeId);
    if (children.length > 0) setActiveById(children[0]);
  }

  function previousParent() {
    if (activeIndex < 0 || !activeId) return startPlayMode();
    const parent = parentId(activeId);
    if (parent) setActiveById(parent);
  }

  function sibling(direction) {
    if (activeIndex < 0 || !activeId) return startPlayMode();
    const parent = parentId(activeId);
    if (!parent) return;
    const siblings = childIds(parent).filter((id) => nodeIds.includes(id));
    const index = siblings.indexOf(activeId);
    const next = siblings[index + direction];
    if (next) setActiveById(next);
  }

  function fit() {
    const { width, height } = svgSize();
    const pad = 48;
    const topPad = chartTitle ? 120 : 48; // Extra space for title
    scale = Math.min((stage.clientWidth - pad * 2) / width, (stage.clientHeight - topPad - pad) / height, 1);
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    tx = (stage.clientWidth - width * scale) / 2;
    ty = (stage.clientHeight - height * scale) / 2 + (chartTitle ? 30 * scale : 0);
    apply();
  }

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    startTx = tx;
    startTy = ty;
    stage.classList.add("dragging");
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    tx = startTx + event.clientX - startX;
    ty = startTy + event.clientY - startY;
    apply();
  });

  function stopDrag(event) {
    dragging = false;
    stage.classList.remove("dragging");
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  }

  stage.addEventListener("pointerup", stopDrag);
  stage.addEventListener("pointercancel", stopDrag);

  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nextScale = Math.max(0.1, Math.min(6, scale * Math.exp(-event.deltaY * 0.001)));
    const factor = nextScale / scale;
    tx = x - (x - tx) * factor;
    ty = y - (y - ty) * factor;
    scale = nextScale;
    apply();
  }, { passive: false });

  stage.addEventListener("dblclick", fit);
  controls.play?.addEventListener("click", () => activeIndex < 0 ? startPlayMode() : stopPlayMode());

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      nextChild();
    } else if (event.key === "ArrowUp" || event.key === "Backspace") {
      event.preventDefault();
      previousParent();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      sibling(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      sibling(-1);
    } else if (event.key === " " || event.key === "Escape") {
      event.preventDefault();
      activeIndex < 0 ? startPlayMode() : stopPlayMode();
    }
  });

  window.addEventListener("resize", fit);
  fit();
})();
</script>
</body>
</html>
`;
}

function copyComputedStyles(source: Element, target: Element) {
  const computed = getComputedStyle(source);
  const existing = target.getAttribute("style") ?? "";
  const inline = STYLE_PROPS
    .map((prop) => {
      const value = computed.getPropertyValue(prop);
      return value ? `${prop}:${value};` : "";
    })
    .join("");
  target.setAttribute("style", `${existing};${inline}`);
  inlineTextColor(source, target, computed);

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  for (let i = 0; i < sourceChildren.length; i++) {
    if (targetChildren[i]) copyComputedStyles(sourceChildren[i], targetChildren[i]);
  }
}

function normalizeTransformValue(value: string) {
  return value
    .replace(/translate\(\s*([-\d.]+)px(?:\s*,\s*|\s+)([-\d.]+)px\s*\)/g, "translate($1 $2)")
    .replace(/translate\(\s*([-\d.]+)px\s*\)/g, "translate($1 0)")
    .replace(/matrix\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g, "matrix($1 $2 $3 $4 $5 $6)");
}

function cssTransformToSvgAttributes(root: SVGElement) {
  for (const el of Array.from(root.querySelectorAll<SVGElement>("*"))) {
    const transform = el.style.transform;
    if (!transform || transform === "none") continue;

    el.setAttribute("transform", normalizeTransformValue(transform));
    el.style.removeProperty("transform");
    el.style.removeProperty("transform-origin");
  }
}

function mermaidNodeMatches(el: Element, nodeId: string): boolean {
  const id = el.id || "";
  if (id === nodeId || id.includes(`-${nodeId}-`) || id.endsWith(`-${nodeId}`) || id.startsWith(`${nodeId}-`)) {
    return true;
  }

  return Array.from(el.classList).some((cls) => cls === nodeId || cls.includes(`-${nodeId}-`));
}

function annotateExportNodeIds(root: SVGSVGElement, chart: ChartGraph | null) {
  if (!chart) return;

  for (const node of chart.nodes) {
    const existing = root.querySelector<SVGElement>(`[data-node="${CSS.escape(node.id)}"]`);
    if (existing) {
      existing.setAttribute("data-export-node-id", node.id);
      continue;
    }

    const mermaidNode = Array.from(root.querySelectorAll<SVGElement>(".node"))
      .find((el) => mermaidNodeMatches(el, node.id));
    mermaidNode?.setAttribute("data-export-node-id", node.id);
  }
}

function numberAttr(el: Element, name: string, fallback = 0) {
  const value = Number.parseFloat(el.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function textLines(text: string, width: number, fontSize: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];

  const maxChars = Math.max(8, Math.floor(width / Math.max(fontSize * 0.55, 1)));
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function visibleText(el: Element) {
  return el.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function usableColor(color: string | undefined, fallbackColor: string) {
  const value = color?.trim();
  if (
    !value ||
    value.toLowerCase() === "currentcolor" ||
    value === "transparent" ||
    value === "rgba(0, 0, 0, 0)" ||
    value === "rgba(0,0,0,0)"
  ) {
    return fallbackColor;
  }
  return value;
}

function isTextElement(el: Element): el is SVGTextElement | SVGTSpanElement {
  const tag = el.tagName.toLowerCase();
  return tag === "text" || tag === "tspan";
}

function inlineTextColor(source: Element, target: Element, computed: CSSStyleDeclaration) {
  if (!isTextElement(target)) return;

  const nodeBg = getComputedStyle(document.documentElement).getPropertyValue("--chart-node-bg").trim() || "#ffffff";
  const fallback = source.closest("[data-node], .node")
    ? readableNodeTextColor()
    : chartTextColor();
  let color = usableColor(computed.color, fallback);

  if (source.closest("[data-node], .node") && contrastRatio(color, nodeBg) < 2) {
    color = fallback;
  }

  target.setAttribute("fill", color);
  target.style.setProperty("fill", color);
  target.style.setProperty("color", color);
}

function labelFromRect(
  kind: RasterLabel["kind"],
  text: string,
  rect: DOMRect,
  svgRect: DOMRect,
  exportWidth: number,
  exportHeight: number,
  style: CSSStyleDeclaration | null,
  fallbackColor: string
): RasterLabel | null {
  if (!text || rect.width <= 0 || rect.height <= 0 || svgRect.width <= 0 || svgRect.height <= 0) {
    return null;
  }

  const fontSize = Number.parseFloat(style?.fontSize ?? "") || 14;
  return {
    kind,
    text,
    x: ((rect.left + rect.width / 2 - svgRect.left) / svgRect.width) * exportWidth,
    y: ((rect.top + rect.height / 2 - svgRect.top) / svgRect.height) * exportHeight,
    width: Math.max(20, (rect.width / svgRect.width) * exportWidth),
    fontSize,
    lineHeight: Math.max(fontSize * 1.18, fontSize + 2),
    fontFamily: style?.fontFamily || "Arial, sans-serif",
    fontWeight: style?.fontWeight || "400",
    color: usableColor(style?.color, fallbackColor),
  };
}

function labelFromForeignObject(
  kind: RasterLabel["kind"],
  foreignObject: SVGForeignObjectElement,
  svg: SVGSVGElement,
  exportWidth: number,
  exportHeight: number,
  style: CSSStyleDeclaration | null,
  fallbackColor: string
): RasterLabel | null {
  const text = visibleText(foreignObject);
  const matrix = foreignObject.getScreenCTM();
  const svgRect = svg.getBoundingClientRect();

  if (!text || !matrix || svgRect.width <= 0 || svgRect.height <= 0) {
    return null;
  }

  const x = numberAttr(foreignObject, "x");
  const y = numberAttr(foreignObject, "y");
  const width = numberAttr(foreignObject, "width", 80);
  const height = numberAttr(foreignObject, "height", 24);
  const center = new DOMPoint(x + width / 2, y + height / 2).matrixTransform(matrix);
  const fontSize = Number.parseFloat(style?.fontSize ?? "") || 14;

  return {
    kind,
    text,
    x: ((center.x - svgRect.left) / svgRect.width) * exportWidth,
    y: ((center.y - svgRect.top) / svgRect.height) * exportHeight,
    width: Math.max(20, (width * Math.abs(matrix.a) / svgRect.width) * exportWidth),
    fontSize,
    lineHeight: Math.max(fontSize * 1.18, fontSize + 2),
    fontFamily: style?.fontFamily || "Arial, sans-serif",
    fontWeight: style?.fontWeight || "400",
    color: usableColor(style?.color, fallbackColor),
  };
}

function labelFromNodeGroup(
  node: SVGGraphicsElement,
  svg: SVGSVGElement,
  exportWidth: number,
  exportHeight: number,
  fallbackColor: string
): RasterLabel | null {
  const labelSource = node.querySelector<HTMLElement>(".nodeLabel, span, div, p");
  const text = labelSource ? visibleText(labelSource) : visibleText(node);
  const matrix = node.getScreenCTM();
  const svgRect = svg.getBoundingClientRect();

  if (!text || !matrix || svgRect.width <= 0 || svgRect.height <= 0) {
    return null;
  }

  let bbox: DOMRect | SVGRect;
  try {
    bbox = node.getBBox();
  } catch {
    return null;
  }

  const center = new DOMPoint(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2).matrixTransform(matrix);
  const style = labelSource ? getComputedStyle(labelSource) : getComputedStyle(node);
  const fontSize = Number.parseFloat(style.fontSize) || 14;

  return {
    kind: "node",
    text,
    x: ((center.x - svgRect.left) / svgRect.width) * exportWidth,
    y: ((center.y - svgRect.top) / svgRect.height) * exportHeight,
    width: Math.max(20, (bbox.width * Math.abs(matrix.a) / svgRect.width) * exportWidth),
    fontSize,
    lineHeight: Math.max(fontSize * 1.18, fontSize + 2),
    fontFamily: style.fontFamily || "Arial, sans-serif",
    fontWeight: style.fontWeight || "400",
    color: usableColor(style.color, fallbackColor),
  };
}

function labelFromNodeLabelElement(
  labelSource: HTMLElement,
  node: SVGGraphicsElement,
  svg: SVGSVGElement,
  exportWidth: number,
  exportHeight: number,
  fallbackColor: string
): RasterLabel | null {
  const text = visibleText(labelSource);
  const svgRect = svg.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();

  if (!text || svgRect.width <= 0 || svgRect.height <= 0 || nodeRect.width <= 0 || nodeRect.height <= 0) {
    return null;
  }

  const style = getComputedStyle(labelSource);
  const fontSize = Number.parseFloat(style.fontSize) || 14;

  return {
    kind: "node",
    text,
    x: ((nodeRect.left + nodeRect.width / 2 - svgRect.left) / svgRect.width) * exportWidth,
    y: ((nodeRect.top + nodeRect.height / 2 - svgRect.top) / svgRect.height) * exportHeight,
    width: Math.max(20, (nodeRect.width / svgRect.width) * exportWidth * 0.82),
    fontSize,
    lineHeight: Math.max(fontSize * 1.18, fontSize + 2),
    fontFamily: "Arial, sans-serif",
    fontWeight: style.fontWeight || "400",
    color: readableNodeTextColor() || fallbackColor,
  };
}

function collectRasterLabels(svg: SVGSVGElement, exportWidth: number, exportHeight: number) {
  const labels: RasterLabel[] = [];
  const svgRect = svg.getBoundingClientRect();
  const rootStyle = getComputedStyle(document.documentElement);
  const fallbackColor = rootStyle.getPropertyValue("--chart-text").trim() || "#111111";

  for (const node of Array.from(svg.querySelectorAll<SVGGraphicsElement>(".node"))) {
    const labelSource = node.querySelector<HTMLElement>(".nodeLabel, span, div, p");
    const label = labelSource
      ? labelFromNodeLabelElement(labelSource, node, svg, exportWidth, exportHeight, fallbackColor)
      : labelFromNodeGroup(node, svg, exportWidth, exportHeight, fallbackColor);
    if (label) labels.push(label);
  }

  for (const foreignObject of Array.from(svg.querySelectorAll<SVGForeignObjectElement>("foreignObject"))) {
    if (foreignObject.closest(".node")) continue;
    const labelSource = foreignObject.querySelector<HTMLElement>(".nodeLabel, .edgeLabel, span, div, p") ?? foreignObject;
    const label = labelFromForeignObject(
      "edge",
      foreignObject,
      svg,
      exportWidth,
      exportHeight,
      getComputedStyle(labelSource),
      fallbackColor
    ) ?? labelFromRect(
      "edge",
      visibleText(foreignObject),
      foreignObject.getBoundingClientRect(),
      svgRect,
      exportWidth,
      exportHeight,
      getComputedStyle(labelSource),
      fallbackColor
    );
    if (label) labels.push(label);
  }

  for (const textEl of Array.from(svg.querySelectorAll("text"))) {
    if (textEl.closest("foreignObject")) continue;
    const text = visibleText(textEl);
    const label = labelFromRect(
      "text",
      text,
      textEl.getBoundingClientRect(),
      svgRect,
      exportWidth,
      exportHeight,
      getComputedStyle(textEl),
      fallbackColor
    );
    if (label) labels.push(label);
  }

  return labels;
}

function convertForeignObjectLabels(sourceSvg: SVGSVGElement, cloneSvg: SVGSVGElement) {
  const sourceObjects = Array.from(sourceSvg.querySelectorAll("foreignObject"));
  const cloneObjects = Array.from(cloneSvg.querySelectorAll("foreignObject"));
  const rootStyle = getComputedStyle(document.documentElement);
  const fallbackColor = rootStyle.getPropertyValue("--chart-text").trim() || "#111111";

  for (let i = 0; i < cloneObjects.length; i++) {
    const source = sourceObjects[i];
    const clone = cloneObjects[i];
    const rawText = source?.textContent?.replace(/\s+/g, " ").trim() || clone.textContent?.replace(/\s+/g, " ").trim() || "";

    if (!rawText || !clone.parentNode) {
      clone.remove();
      continue;
    }

    const labelSource = source?.querySelector<HTMLElement>("span, div, p") ?? source;
    const labelStyle = labelSource ? getComputedStyle(labelSource) : null;
    const x = numberAttr(clone, "x");
    const y = numberAttr(clone, "y");
    const width = numberAttr(clone, "width", 80);
    const height = numberAttr(clone, "height", 24);
    const fontSize = Number.parseFloat(labelStyle?.fontSize ?? "") || 14;
    const lineHeight = Math.max(fontSize * 1.18, fontSize + 2);
    const lines = textLines(rawText, width, fontSize);
    const isNodeLabel = !!source?.closest(".node, [data-node]");
    let labelColor = usableColor(labelStyle?.color, isNodeLabel ? readableNodeTextColor() : fallbackColor);
    if (isNodeLabel && contrastRatio(labelColor, getComputedStyle(document.documentElement).getPropertyValue("--chart-node-bg").trim() || "#ffffff") < 2) {
      labelColor = readableNodeTextColor();
    }

    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", `${x + width / 2}`);
    const firstLineY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35;
    text.setAttribute("y", `${firstLineY}`);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", labelColor);
    text.setAttribute("font-family", labelStyle?.fontFamily || "Arial, sans-serif");
    text.setAttribute("font-size", `${fontSize}`);
    text.setAttribute("font-weight", labelStyle?.fontWeight || "400");
    text.setAttribute("style", `fill:${labelColor};color:${labelColor};font-family:${labelStyle?.fontFamily || "Arial, sans-serif"};font-size:${fontSize}px;font-weight:${labelStyle?.fontWeight || "400"};`);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const tspan = document.createElementNS(SVG_NS, "tspan");
      tspan.setAttribute("x", `${x + width / 2}`);
      tspan.setAttribute("y", `${firstLineY + lineIndex * lineHeight}`);
      tspan.textContent = lines[lineIndex];
      text.appendChild(tspan);
    }

    clone.parentNode.replaceChild(text, clone);
  }
}

function svgSize(svg: SVGSVGElement) {
  const viewBox = svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(Math.round(viewBox?.width || rect.width || 1200), 1);
  const height = Math.max(Math.round(viewBox?.height || rect.height || 800), 1);
  return { width, height };
}

function injectExportTitle(sourceSvg: SVGSVGElement, cloneSvg: SVGSVGElement, chart: ChartGraph) {
  const title = chart.meta?.title;
  if (!title || title === "Untitled") return;
  if (cloneSvg.querySelector("[data-chart-title]")) return; // custom renderer already has it

  const startNodeId = chart.nodes.find((n) => n.type === "start")?.id ?? chart.nodes[0]?.id;
  if (!startNodeId) return;

  const nodeEl = Array.from(sourceSvg.querySelectorAll<SVGElement>(".node"))
    .find((el) => mermaidNodeMatches(el, startNodeId));
  if (!nodeEl) return;

  const m = nodeEl.getAttribute("transform")?.match(/translate\(([-\d.]+)[,\s]+([-\d.]+)\)/);
  if (!m) return;
  const nx = parseFloat(m[1]);
  const ny = parseFloat(m[2]);
  let nodeHeight = 34;
  try { nodeHeight = (nodeEl as SVGGraphicsElement).getBBox().height; } catch { /* ignore */ }

  const color = chartTextColor();
  const textEl = document.createElementNS(SVG_NS, "text");
  textEl.setAttribute("x", String(nx));
  textEl.setAttribute("y", String(ny - nodeHeight / 2 - 15));
  textEl.setAttribute("text-anchor", "middle");
  textEl.setAttribute("dominant-baseline", "auto");
  textEl.setAttribute("font-size", "22");
  textEl.setAttribute("font-weight", "700");
  textEl.setAttribute("fill", color);
  textEl.style.setProperty("fill", color);
  textEl.style.setProperty("opacity", "0.9");
  textEl.textContent = title;
  cloneSvg.appendChild(textEl);
}

function prepareSvg(svg: SVGSVGElement, chart: ChartGraph | null) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  copyComputedStyles(svg, clone);
  cssTransformToSvgAttributes(clone);
  annotateExportNodeIds(clone, chart);
  convertForeignObjectLabels(svg, clone);
  if (chart) injectExportTitle(svg, clone, chart);

  const { width, height } = svgSize(svg);
  const labels = collectRasterLabels(svg, width, height);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", `${width}`);
  clone.setAttribute("height", `${height}`);
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  const rootStyle = getComputedStyle(document.documentElement);
  const background = rootStyle.getPropertyValue("--chart-bg").trim() || "transparent";
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", background);
  clone.insertBefore(bg, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  return {
    width,
    height,
    labels,
    xml: xml.startsWith("<?xml") ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`,
  };
}

function paintRasterLabels(ctx: CanvasRenderingContext2D, labels: RasterLabel[], scale: number) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const label of labels) {
    const color = label.kind === "node" ? readableNodeTextColor() : label.color;
    ctx.fillStyle = color;
    ctx.font = `${label.fontWeight} ${label.fontSize * scale}px ${label.fontFamily}`;
    const lines = textLines(label.text, label.width, label.fontSize);
    const lineHeight = label.lineHeight * scale;
    const startY = label.y * scale - ((lines.length - 1) * lineHeight) / 2;

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], label.x * scale, startY + i * lineHeight, label.width * scale);
    }
  }

  ctx.restore();
}

async function svgToCanvas(svgXml: string, width: number, height: number, labels: RasterLabel[], scale = 2) {
  const blob = new Blob([svgXml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to render SVG for export."));
    });
    image.src = url;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas export is not available.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    paintRasterLabels(ctx, labels, scale);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`Unable to create ${type} export.`));
    }, type, quality);
  });
}

function concatBytes(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function jpegPdfBlob(canvas: HTMLCanvasElement) {
  const jpeg = new Uint8Array(await (await canvasToBlob(canvas, "image/jpeg", 0.94)).arrayBuffer());
  const encoder = new TextEncoder();
  const width = Math.round(canvas.width * 0.75);
  const height = Math.round(canvas.height * 0.75);
  const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    [
      encoder.encode(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg,
      encoder.encode("\nendstream\nendobj\n"),
    ],
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
  ];

  const parts: Uint8Array[] = [encoder.encode("%PDF-1.4\n")];
  const offsets = [0];
  let offset = parts[0].length;

  for (const object of objects) {
    offsets.push(offset);
    const bytes = Array.isArray(object) ? concatBytes(object) : encoder.encode(object);
    parts.push(bytes);
    offset += bytes.length;
  }

  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  parts.push(encoder.encode(xref));

  return new Blob([concatBytes(parts)], { type: "application/pdf" });
}

export async function exportDiagram(container: HTMLElement | null, title: string, format: ExportFormat, chart: ChartGraph | null = null) {
  const svg = container?.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error("No diagram SVG is available to export.");
  }

  const filename = safeName(title);
  const prepared = prepareSvg(svg, chart);
  console.log(
    `[export] prepared ${format}: ${prepared.width}x${prepared.height}, ` +
    `${prepared.labels.filter((label) => label.kind === "node").length} node labels, ` +
    `${prepared.labels.filter((label) => label.kind === "edge").length} edge labels, ` +
    `${prepared.labels.filter((label) => label.kind === "text").length} svg text labels`
  );

  if (format === "svg") {
    downloadBlob(new Blob([prepared.xml], { type: "image/svg+xml;charset=utf-8" }), `${filename}.svg`);
    return;
  }

  if (format === "html") {
    downloadBlob(new Blob([standaloneHtml(title, prepared.xml, chart)], { type: "text/html;charset=utf-8" }), `${filename}.html`);
    return;
  }

  if (format === "ascii") {
    const text = renderAscii(chart ?? { nodes: [], edges: [], meta: { title, direction: "vertical", version: "1.0", type: "flowchart" }, styles: { classes: {}, nodeStyles: {}, edgeStyles: {} }, extensions: {} });
    downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${filename}.txt`);
    return;
  }

  const canvas = await svgToCanvas(prepared.xml, prepared.width, prepared.height, prepared.labels);
  if (format === "png") {
    downloadBlob(await canvasToBlob(canvas, "image/png"), `${filename}.png`);
    return;
  }

  downloadBlob(await jpegPdfBlob(canvas), `${filename}.pdf`);
}
