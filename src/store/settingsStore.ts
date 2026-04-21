import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyTheme, type ColorMode } from "../themes";

interface SettingsState {
  theme: string;
  colorMode: ColorMode;
  setTheme: (theme: string) => void;
  setColorMode: (mode: ColorMode) => void;
}

function safeColorMode(value: unknown): ColorMode {
  return value === "light" || value === "dark" ? value : "dark";
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "raven",
      colorMode: "dark",

      setTheme: (theme) => {
        applyTheme(theme, get().colorMode);
        set({ theme });
      },

      setColorMode: (colorMode) => {
        applyTheme(get().theme, colorMode);
        set({ colorMode });
      },
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
