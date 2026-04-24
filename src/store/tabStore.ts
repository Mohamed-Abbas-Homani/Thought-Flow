import { create } from "zustand";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { ChartGraph } from "../lib/chart/types";
import type { ChartThemeTokens } from "./settingsStore";
import { chartToMermaid } from "../lib/chart/mermaid";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface Tab {
  path: string;
  name: string;
  messages: ChatMessage[];
  chart: ChartGraph | null;
  isDirty: boolean;
}

const DELIMITER = "\n[+]\n";

function parseFile(raw: string): { messages: ChatMessage[]; chart: ChartGraph | null } {
  const idx = raw.indexOf(DELIMITER);
  const part1 = idx === -1 ? raw : raw.slice(0, idx);
  const part2 = idx === -1 ? ""  : raw.slice(idx + DELIMITER.length);

  let messages: ChatMessage[] = [];
  let chart: ChartGraph | null = null;

  try { messages = JSON.parse(part1.trim()) ?? []; } catch { /* empty or malformed */ }
  try { chart    = JSON.parse(part2.trim());        } catch { /* no chart yet */ }

  return { messages, chart };
}

function serializeTab(tab: Tab): string {
  const part1 = JSON.stringify(tab.messages);
  const part2 = tab.chart ? JSON.stringify(tab.chart) : "";
  return part1 + DELIMITER + part2;
}

interface TabStore {
  tabs: Tab[];
  activeTabPath: string | null;
  openTab:       (path: string, name: string) => Promise<void>;
  closeTab:      (path: string) => void;
  setActiveTab:  (path: string) => void;
  updatePath:    (oldPath: string, newPath: string, newName?: string) => void;
  addMessage:    (path: string, msg: ChatMessage) => void;
  setChart:      (path: string, chart: ChartGraph) => void;
  applyChartTheme: (path: string, tokens: ChartThemeTokens) => Promise<void>;
  renameNode:    (path: string, nodeId: string, newText: string) => Promise<void>;
  renameEdge:    (path: string, from: string, to: string, currentLabel: string, newLabel: string) => Promise<void>;
  saveTab:       (path: string) => Promise<void>;
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabPath: null,

  openTab: async (path, name) => {
    // No-op if already open — just switch to it
    if (get().tabs.some((t) => t.path === path)) {
      set({ activeTabPath: path });
      return;
    }

    let messages: ChatMessage[] = [];
    let chart: ChartGraph | null = null;

    try {
      const raw = await readTextFile(path);
      ({ messages, chart } = parseFile(raw));
    } catch {
      // New file not yet on disk — start empty
    }

    set((s) => ({
      tabs: [...s.tabs, { path, name, messages, chart, isDirty: false }],
      activeTabPath: path,
    }));
  },

  closeTab: (path) => {
    set((s) => {
      const idx     = s.tabs.findIndex((t) => t.path === path);
      const newTabs = s.tabs.filter((t) => t.path !== path);
      let active    = s.activeTabPath;

      if (active === path) {
        const next = newTabs[idx] ?? newTabs[idx - 1] ?? null;
        active = next?.path ?? null;
      }

      return { tabs: newTabs, activeTabPath: active };
    });
  },

  setActiveTab: (path) => set({ activeTabPath: path }),

  updatePath: (oldPath, newPath, newName) => {
    if (oldPath === newPath) return;
    set((s) => {
      const existingNewTab = s.tabs.find((t) => t.path === newPath);
      const movedTab = s.tabs.find((t) => t.path === oldPath);

      if (existingNewTab && movedTab) {
        return {
          tabs: s.tabs.filter((t) => t.path !== oldPath),
          activeTabPath: s.activeTabPath === oldPath ? newPath : s.activeTabPath,
        };
      }

      return {
        tabs: s.tabs.map((t) => {
          if (t.path === oldPath) {
            return { ...t, path: newPath, name: newName ?? t.name };
          }

          if (t.path.startsWith(`${oldPath}/`)) {
            const suffix = t.path.slice(oldPath.length);
            return { ...t, path: `${newPath}${suffix}` };
          }

          return t;
        }),
        activeTabPath:
          s.activeTabPath === oldPath
            ? newPath
            : s.activeTabPath?.startsWith(`${oldPath}/`)
              ? `${newPath}${s.activeTabPath.slice(oldPath.length)}`
              : s.activeTabPath,
      };
    });
  },

  addMessage: (path, msg) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path
          ? { ...t, messages: [...t.messages, msg], isDirty: true }
          : t
      ),
    }));
  },

  setChart: (path, chart) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, chart, isDirty: true } : t
      ),
    }));
  },

  applyChartTheme: async (path, tokens) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.path !== path || !t.chart) return t;

        const nodeStyle = {
          background: tokens["chart-node-bg"],
          border: tokens["chart-node-border"],
          text: tokens["chart-text"],
        };
        const edgeStyle = {
          border: tokens["chart-edge"],
          text: tokens["chart-text"],
        };

        const chart: ChartGraph = {
          ...t.chart,
          styles: {
            ...t.chart.styles,
            nodeStyles: Object.fromEntries(t.chart.nodes.map((n) => [n.id, nodeStyle])),
            edgeStyles: Object.fromEntries(
              t.chart.edges.map((e, i) => [`${e.from}->${e.to}:${i}`, edgeStyle])
            ),
          },
          extensions: {
            ...t.chart.extensions,
            chartTheme: {
              background: tokens["chart-bg"],
              nodeBackground: tokens["chart-node-bg"],
              nodeBorder: tokens["chart-node-border"],
              edge: tokens["chart-edge"],
              text: tokens["chart-text"],
            },
          },
        };

        console.log("[theme:chart] applied to chart:", {
          path,
          nodes: chart.nodes.length,
          edges: chart.edges.length,
          tokens,
        });

        return { ...t, chart, isDirty: true };
      }),
    }));
    await get().saveTab(path);
  },

  renameNode: async (path, nodeId, newText) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.path !== path || !t.chart) return t;
        const chart = {
          ...t.chart,
          nodes: t.chart.nodes.map((n) =>
            n.id === nodeId ? { ...n, text: newText } : n
          ),
        };
        // Sync the last assistant message so the patcher prompt sees the new label
        const newMermaid = chartToMermaid(chart);
        let lastAssistantIdx = -1;
        for (let i = t.messages.length - 1; i >= 0; i--) {
          if (t.messages[i].role === "assistant") { lastAssistantIdx = i; break; }
        }
        const messages = lastAssistantIdx >= 0 && t.messages[lastAssistantIdx].content.includes("graph ")
          ? t.messages.map((m, i) => i === lastAssistantIdx ? { ...m, content: newMermaid } : m)
          : t.messages;
        return { ...t, chart, messages, isDirty: true };
      }),
    }));
    await get().saveTab(path);
  },

  renameEdge: async (path, from, to, currentLabel, newLabel) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.path !== path || !t.chart) return t;
        let updated = false;
        const chart = {
          ...t.chart,
          edges: t.chart.edges.map((e) => {
            if (!updated && e.from === from && e.to === to && e.label === currentLabel) {
              updated = true;
              return { ...e, label: newLabel, type: (newLabel ? "conditional" : "sequential") as "conditional" | "sequential" };
            }
            return e;
          }),
        };
        const newMermaid = chartToMermaid(chart);
        let lastAssistantIdx = -1;
        for (let i = t.messages.length - 1; i >= 0; i--) {
          if (t.messages[i].role === "assistant") { lastAssistantIdx = i; break; }
        }
        const messages = lastAssistantIdx >= 0 && t.messages[lastAssistantIdx].content.includes("graph ")
          ? t.messages.map((m, i) => i === lastAssistantIdx ? { ...m, content: newMermaid } : m)
          : t.messages;
        return { ...t, chart, messages, isDirty: true };
      }),
    }));
    await get().saveTab(path);
  },

  saveTab: async (path) => {
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab) return;
    await writeTextFile(path, serializeTab(tab));
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, isDirty: false } : t)),
    }));
  },
}));
