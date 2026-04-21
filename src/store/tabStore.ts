import { create } from "zustand";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { ChartGraph } from "../lib/chart/types";

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
  addMessage:    (path: string, msg: ChatMessage) => void;
  setChart:      (path: string, chart: ChartGraph) => void;
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

  saveTab: async (path) => {
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab) return;
    await writeTextFile(path, serializeTab(tab));
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, isDirty: false } : t)),
    }));
  },
}));
