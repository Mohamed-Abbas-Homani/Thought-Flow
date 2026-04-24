import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X, PanelLeft, Settings, Sun, Moon, MessageSquare } from "lucide-react";
import { SettingsModal } from "./SettingsModal";
import { TabBar } from "./TabBar";
import { useSettingsStore } from "../store/settingsStore";
import { useLayoutStore } from "../store/layoutStore";

const appWindow = getCurrentWindow();

interface TitleBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

export function TitleBar({ sidebarOpen, onToggleSidebar, chatOpen, onToggleChat }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const { colorMode, setColorMode, openSettings } = useSettingsStore();
  const { sidebarWidth } = useLayoutStore();

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);

    let unlistenResize: (() => void) | undefined;
    appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    }).then((fn) => { unlistenResize = fn; });

    return () => unlistenResize?.();
  }, []);

  function handleDragMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, select, [role='button']")) return;

    if (isMaximized) {
      void appWindow.toggleMaximize();
      setIsMaximized(false);
    }

    void appWindow.startDragging();
  }

  const iconBtn = "h-full px-2.5 flex items-center justify-center bg-transparent border-none cursor-default transition-colors hover:bg-primary";

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 h-[42px] flex items-center justify-between bg-background text-foreground text-xs select-none z-50 border-b border-border"
        onMouseDown={handleDragMouseDown}
      >
        {/* Left: sidebar control + settings */}
        <div 
          className="flex items-stretch h-full overflow-hidden transition-[width] duration-300 ease-in-out" 
          style={{ width: sidebarOpen ? sidebarWidth : 120 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            className={`${iconBtn} ${sidebarOpen ? "text-foreground" : "text-foreground/50 hover:text-foreground"}`}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={18} strokeWidth={1.5} />
          </button>

          <button
            title="Settings"
            className={`${iconBtn} text-foreground/50 hover:text-foreground`}
            onClick={() => openSettings()}
          >
            <Settings size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Center: open tabs */}
        <div className="flex-1 flex items-stretch h-full min-w-0 overflow-hidden" onMouseDown={handleDragMouseDown}>
          <TabBar />
        </div>

        {/* Right: window controls */}
        <div className="flex items-stretch h-full" onMouseDown={(e) => e.stopPropagation()}>
          <button
            title={chatOpen ? "Collapse chat" : "Expand chat"}
            className={`${iconBtn} ${chatOpen ? "text-foreground" : "text-foreground/50 hover:text-foreground"}`}
            onClick={onToggleChat}
          >
            <MessageSquare size={18} strokeWidth={1.5} />
          </button>

          <button
            title={colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="flex items-center justify-center w-[46px] h-full bg-transparent border-none text-foreground/70 hover:text-foreground hover:bg-primary cursor-default transition-colors"
            onClick={() => setColorMode(colorMode === "dark" ? "light" : "dark")}
          >
            {colorMode === "dark" ? <Sun size={17} strokeWidth={1.5} /> : <Moon size={17} strokeWidth={1.5} />}
          </button>

          <button
            title="Minimize"
            className="flex items-center justify-center w-[46px] h-full bg-transparent border-none text-foreground/70 hover:text-foreground hover:bg-primary cursor-default transition-colors"
            onClick={() => appWindow.minimize()}
          >
            <Minus size={17} strokeWidth={1.5} />
          </button>
          <button
            title={isMaximized ? "Restore" : "Maximize"}
            className="flex items-center justify-center w-[46px] h-full bg-transparent border-none text-foreground/70 hover:text-foreground hover:bg-primary cursor-default transition-colors"
            onClick={() => appWindow.toggleMaximize()}
          >
            {isMaximized
              ? <Copy size={16} strokeWidth={1.5} />
              : <Square size={16} strokeWidth={1.5} />
            }
          </button>
          <button
            title="Close"
            className="flex items-center justify-center w-[46px] h-full bg-transparent border-none text-foreground/70 hover:text-foreground hover:bg-error cursor-default transition-colors"
            onClick={() => appWindow.close()}
          >
            <X size={17} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <SettingsModal />
    </>
  );
}
