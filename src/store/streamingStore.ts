import { create } from "zustand";

interface StreamingStore {
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
}

export const useStreamingStore = create<StreamingStore>((set) => ({
  isStreaming: false,
  setIsStreaming: (isStreaming) => set({ isStreaming }),
}));
