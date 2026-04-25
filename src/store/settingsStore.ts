import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyTheme,
  applyThemeTokens,
  themes,
  type ColorMode,
  type Theme,
  type ThemeTokens,
} from "../themes";

export type LLMProvider = "ollama" | "openai" | "anthropic";
export type SettingsSection = "theme" | "model" | "chartTheme";

export type ChartThemeTokens = Pick<
  ThemeTokens,
  | "chart-bg"
  | "chart-node-bg"
  | "chart-node-border"
  | "chart-edge"
  | "chart-text"
>;

interface SettingsState {
  theme: string;
  colorMode: ColorMode;
  customThemes: Record<string, Theme>;
  chartThemePrompt: string;
  chartThemeTokens: ChartThemeTokens | null;
  llmProvider: LLMProvider;
  llmUrl: string;
  llmModel: string;
  llmApiKey: string;
  anthropicMaxTokens: number;

  isSettingsOpen: boolean;
  activeSection: SettingsSection;

  setTheme: (theme: string) => void;
  setColorMode: (mode: ColorMode) => void;
  addCustomTheme: (theme: Theme) => string;
  deleteCustomTheme: (themeKey: string) => void;
  setChartTheme: (prompt: string, tokens: ChartThemeTokens | null) => void;
  setLLMConfig: (
    config: Partial<
      Pick<
        SettingsState,
        | "llmProvider"
        | "llmUrl"
        | "llmModel"
        | "llmApiKey"
        | "anthropicMaxTokens"
      >
    >,
  ) => void;

  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
}

function safeColorMode(value: unknown): ColorMode {
  return value === "light" || value === "dark" ? value : "dark";
}

function allThemes(customThemes: Record<string, Theme>) {
  return { ...themes, ...customThemes };
}

function applySettingsTheme(
  theme: string,
  colorMode: ColorMode,
  customThemes: Record<string, Theme>,
  chartThemeTokens: ChartThemeTokens | null,
) {
  applyTheme(theme, colorMode, allThemes(customThemes));
  if (chartThemeTokens) applyThemeTokens(chartThemeTokens);
}

function slugifyThemeName(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "custom-theme"
  );
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "raven",
      colorMode: "dark",
      customThemes: {},
      chartThemePrompt: "",
      chartThemeTokens: null,
      llmProvider: "ollama",
      llmUrl: "http://localhost:11434",
      llmModel: "qwen3:14b",
      llmApiKey: "",
      anthropicMaxTokens: 1024,

      isSettingsOpen: false,
      activeSection: "theme",

      setTheme: (theme) => {
        const { colorMode, customThemes, chartThemeTokens } = get();
        applySettingsTheme(theme, colorMode, customThemes, chartThemeTokens);
        set({ theme });
      },

      setColorMode: (colorMode) => {
        const { theme, customThemes, chartThemeTokens } = get();
        applySettingsTheme(theme, colorMode, customThemes, chartThemeTokens);
        set({ colorMode });
      },

      addCustomTheme: (newTheme) => {
        const baseKey = `custom-${slugifyThemeName(newTheme.name)}`;
        let key = baseKey;
        let i = 2;
        while (get().customThemes[key] || themes[key]) {
          key = `${baseKey}-${i++}`;
        }
        const customThemes = { ...get().customThemes, [key]: newTheme };
        applySettingsTheme(
          key,
          get().colorMode,
          customThemes,
          get().chartThemeTokens,
        );
        set({ customThemes, theme: key });
        return key;
      },

      deleteCustomTheme: (themeKey) => {
        if (!get().customThemes[themeKey]) return;

        const { [themeKey]: _deleted, ...customThemes } = get().customThemes;
        const nextTheme = get().theme === themeKey ? "raven" : get().theme;

        applySettingsTheme(
          nextTheme,
          get().colorMode,
          customThemes,
          get().chartThemeTokens,
        );
        set({ customThemes, theme: nextTheme });
      },

      setChartTheme: (chartThemePrompt, chartThemeTokens) => {
        applySettingsTheme(
          get().theme,
          get().colorMode,
          get().customThemes,
          chartThemeTokens,
        );
        set({ chartThemePrompt, chartThemeTokens });
      },

      setLLMConfig: (config) => set(config),

      openSettings: (section = "theme") =>
        set({ isSettingsOpen: true, activeSection: section }),
      closeSettings: () => set({ isSettingsOpen: false }),
    }),
    {
      name: "thought-flow-settings",
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const colorMode = safeColorMode(state.colorMode);
        if (colorMode !== state.colorMode) {
          useSettingsStore.setState({ colorMode });
        }
        applySettingsTheme(
          state.theme,
          colorMode,
          state.customThemes ?? {},
          state.chartThemeTokens ?? null,
        );
      },
    },
  ),
);
