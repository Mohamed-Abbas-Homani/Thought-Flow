import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LayoutState {
  sidebarWidth: number;
  sidebarOpen: boolean;
  chatWidth: number;
  chatOpen: boolean;

  setSidebarWidth: (w: number) => void;
  setSidebarOpen: (o: boolean) => void;
  toggleSidebar: () => void;

  setChatWidth: (w: number) => void;
  setChatOpen: (o: boolean) => void;
  toggleChat: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarWidth: 240,
      sidebarOpen: true,
      chatWidth: 320,
      chatOpen: true,

      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

      setChatWidth: (chatWidth) => set({ chatWidth }),
      setChatOpen: (chatOpen) => set({ chatOpen }),
      toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
    }),
    {
      name: "thought-flow-layout",
    },
  ),
);
