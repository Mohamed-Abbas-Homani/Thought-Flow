import { useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { Flowchart } from "./components/Flowchart";
import { applyTheme } from "./themes";
import { useSettingsStore } from "./store/settingsStore";
import { useTabStore } from "./store/tabStore";
import "./App.css";

// Apply theme immediately so CSS vars are set before first paint
const { theme, colorMode } = useSettingsStore.getState();
applyTheme(theme, colorMode);

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen]       = useState(true);

  const { tabs, activeTabPath } = useTabStore();
  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;

  return (
    <>
      <TitleBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((o) => !o)}
      />
      <div className="app-body">
        {sidebarOpen && <Sidebar />}

        <main className="flex-1 overflow-hidden relative">
          {activeTab ? (
            <Flowchart
              key={activeTab.path}
              chart={activeTab.chart}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-[13px] pointer-events-none select-none">
              Select or create a file to begin
            </div>
          )}
        </main>

        {chatOpen && <ChatPanel />}
      </div>
    </>
  );
}

export default App;
