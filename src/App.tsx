import { useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { Flowchart } from "./components/Flowchart";
import { MermaidRenderer } from "./components/MermaidRenderer";
import { applyTheme } from "./themes";
import { useSettingsStore } from "./store/settingsStore";
import { useTabStore } from "./store/tabStore";
import { useLayoutStore } from "./store/layoutStore";
import "./App.css";

// Apply theme immediately so CSS vars are set before first paint
const { theme, colorMode } = useSettingsStore.getState();
applyTheme(theme, colorMode);

type RendererMode = "mermaid" | "custom";

function App() {
  const { sidebarOpen, toggleSidebar, chatOpen, toggleChat } = useLayoutStore();
  const [renderer, setRenderer] = useState<RendererMode>("mermaid");

  const { tabs, activeTabPath } = useTabStore();
  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;

  return (
    <>
      <TitleBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        chatOpen={chatOpen}
        onToggleChat={toggleChat}
      />
      <div className="app-body pt-[42px]">
        {sidebarOpen && <Sidebar />}

        <main className="flex-1 overflow-hidden relative">
          {activeTab ? (
            renderer === "mermaid" ? (
              <MermaidRenderer key={activeTab.path} chart={activeTab.chart} />
            ) : (
              <Flowchart key={activeTab.path} chart={activeTab.chart} />
            )
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-[13px] pointer-events-none select-none">
              Select or create a file to begin
            </div>
          )}

          {/* Renderer toggle — top-right corner of canvas */}
          <div className="absolute top-3 right-3 flex rounded-md border border-border overflow-hidden text-[11px]">
            <button
              onClick={() => setRenderer("mermaid")}
              className={`px-2 py-1 cursor-default transition-colors ${
                renderer === "mermaid"
                  ? "bg-ring text-background"
                  : "bg-primary text-muted-foreground hover:text-foreground"
              }`}
              title="Mermaid.js renderer"
            >
              mermaid
            </button>
            <button
              onClick={() => setRenderer("custom")}
              className={`px-2 py-1 cursor-default transition-colors ${
                renderer === "custom"
                  ? "bg-ring text-background"
                  : "bg-primary text-muted-foreground hover:text-foreground"
              }`}
              title="Custom SVG renderer"
            >
              custom
            </button>
          </div>
        </main>

        {chatOpen && <ChatPanel />}
      </div>
    </>
  );
}

export default App;
