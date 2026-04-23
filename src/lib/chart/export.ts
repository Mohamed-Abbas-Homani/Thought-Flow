import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { save } from "@tauri-apps/plugin-dialog";
import { jsPDF } from "jspdf";

export type ExportFormat = "svg" | "png" | "pdf";

type ExportColors = {
  background: string;
  nodeBackground: string;
  nodeBorder: string;
  edge: string;
  text: string;
  foreground: string;
  ring: string;
};

function getVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function getChartExportColors(): ExportColors {
  return {
    background: getVar("--chart-bg"),
    nodeBackground: getVar("--chart-node-bg"),
    nodeBorder: getVar("--chart-node-border"),
    edge: getVar("--chart-edge"),
    text: getVar("--chart-text"),
    foreground: getVar("--foreground"),
    ring: getVar("--ring"),
  };
}

export function sanitizeExportName(name?: string | null): string {
  const trimmed = (name || "flowchart").trim();
  const safe = trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return safe || "flowchart";
}

function ensureSvgDocument(svg: string): string {
  let out = svg.trim();
  if (!out.startsWith("<svg")) {
    throw new Error("Export source is not an SVG document.");
  }
  if (!out.includes('xmlns="http://www.w3.org/2000/svg"')) {
    out = out.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!out.includes('xmlns:xlink="http://www.w3.org/1999/xlink"')) {
    out = out.replace("<svg", '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  return out;
}

function parseSvgSize(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/viewBox="[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)"/i);
  if (viewBox) {
    return {
      width: Math.max(1, Math.ceil(parseFloat(viewBox[1]))),
      height: Math.max(1, Math.ceil(parseFloat(viewBox[2]))),
    };
  }

  const widthMatch = svg.match(/\swidth="([-\d.]+)"/i);
  const heightMatch = svg.match(/\sheight="([-\d.]+)"/i);
  if (widthMatch && heightMatch) {
    return {
      width: Math.max(1, Math.ceil(parseFloat(widthMatch[1]))),
      height: Math.max(1, Math.ceil(parseFloat(heightMatch[1]))),
    };
  }

  return { width: 1600, height: 900 };
}

async function svgToImage(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([ensureSvgDocument(svg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load SVG for export."));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function svgToPngBytes(svg: string, scale = 3.5): Promise<{ bytes: Uint8Array; width: number; height: number; dataUrl: string }> {
  const safeSvg = ensureSvgDocument(svg);
  const { width, height } = parseSvgSize(safeSvg);
  const img = await svgToImage(safeSvg);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas export is not available.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Failed to encode PNG export."));
    }, "image/png");
  });

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dataUrl = canvas.toDataURL("image/png");
  return { bytes, width, height, dataUrl };
}

async function svgToPdfBytes(svg: string): Promise<Uint8Array> {
  const { width, height, dataUrl } = await svgToPngBytes(svg, 3.5);
  const pageWidth = Math.max(1, width * 0.75);
  const pageHeight = Math.max(1, height * 0.75);
  const pdf = new jsPDF({
    orientation: pageWidth >= pageHeight ? "landscape" : "portrait",
    unit: "pt",
    format: [pageWidth, pageHeight],
    compress: true,
  });
  pdf.addImage(dataUrl, "PNG", 0, 0, pageWidth, pageHeight, undefined, "FAST");
  return new Uint8Array(pdf.output("arraybuffer"));
}

async function saveBytes(defaultName: string, extension: ExportFormat, bytes: Uint8Array): Promise<boolean> {
  const path = await save({
    title: `Export ${extension.toUpperCase()}`,
    defaultPath: `${defaultName}.${extension}`,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  if (!path) return false;
  await writeFile(path, bytes, { create: true });
  return true;
}

async function saveText(defaultName: string, content: string): Promise<boolean> {
  const path = await save({
    title: "Export SVG",
    defaultPath: `${defaultName}.svg`,
    filters: [{ name: "SVG", extensions: ["svg"] }],
  });
  if (!path) return false;
  await writeTextFile(path, content, { create: true });
  return true;
}

export async function exportSvgFile(svg: string, fileBaseName: string): Promise<boolean> {
  return saveText(fileBaseName, ensureSvgDocument(svg));
}

export async function exportPngFile(svg: string, fileBaseName: string): Promise<boolean> {
  const { bytes } = await svgToPngBytes(svg, 3.5);
  return saveBytes(fileBaseName, "png", bytes);
}

export async function exportPdfFile(svg: string, fileBaseName: string): Promise<boolean> {
  const bytes = await svgToPdfBytes(svg);
  return saveBytes(fileBaseName, "pdf", bytes);
}
