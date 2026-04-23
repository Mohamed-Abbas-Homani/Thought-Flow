import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyTheme, type ColorMode } from "../themes";

export type LLMProvider = "ollama" | "openai" | "anthropic";
export type SettingsSection = "theme" | "model";

interface SettingsState {
  theme: string;
  colorMode: ColorMode;
  llmProvider: LLMProvider;
  llmUrl: string;
  llmModel: string;
  llmApiKey: string;
  
  isSettingsOpen: boolean;
  activeSection: SettingsSection;

  setTheme: (theme: string) => void;
  setColorMode: (mode: ColorMode) => void;
  setLLMConfig: (config: Partial<Pick<SettingsState, "llmProvider" | "llmUrl" | "llmModel" | "llmApiKey">>) => void;
  
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
}

function safeColorMode(value: unknown): ColorMode {
  return value === "light" || value === "dark" ? value : "dark";
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "raven",
      colorMode: "dark",
      llmProvider: "ollama",
      llmUrl: "http://localhost:11434",
      llmModel: "qwen3:14b",
      llmApiKey: "",

      isSettingsOpen: false,
      activeSection: "theme",

      setTheme: (theme) => {
        applyTheme(theme, get().colorMode);
        set({ theme });
      },

      setColorMode: (colorMode) => {
        applyTheme(get().theme, colorMode);
        set({ colorMode });
      },

      setLLMConfig: (config) => set(config),

      openSettings: (section = "theme") => set({ isSettingsOpen: true, activeSection: section }),
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
        applyTheme(state.theme, colorMode);
      },
    }
  )
);
