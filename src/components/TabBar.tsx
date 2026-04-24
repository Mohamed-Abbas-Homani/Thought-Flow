import { useRef, useEffect } from "react";
import { X, Circle } from "lucide-react";
import { useTabStore } from "../store/tabStore";

export function TabBar() {
  const { tabs, activeTabPath, setActiveTab, closeTab } = useTabStore();
  const activeRef = useRef<HTMLButtonElement>(null);

  // Scroll active tab into view when it changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "nearest", behavior: "smooth" });
  }, [activeTabPath]);

  if (tabs.length === 0) return null;

  return (
    <div className="flex-1 flex items-stretch overflow-x-auto scrollbar-none min-w-0">
      {tabs.map((tab) => {
        const isActive = tab.path === activeTabPath;
        return (
          <div
            key={tab.path}
            className={`relative flex items-center shrink-0 h-full border-r border-border transition-colors ${
              isActive
                ? "bg-primary text-foreground"
                : "text-foreground/50 hover:text-foreground hover:bg-primary/30"
            }`}
          >
            {/* Active bottom accent */}
            {isActive && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-ring" />
            )}

            <button
              ref={isActive ? activeRef : undefined}
              onClick={() => setActiveTab(tab.path)}
              className="pl-3 pr-1.5 h-full flex items-center text-[12px] cursor-default whitespace-nowrap"
            >
              {tab.name}
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
              className="pr-2 h-full flex items-center text-foreground/30 hover:text-foreground cursor-default transition-colors"
            >
              {tab.isDirty
                ? <Circle size={8} className="fill-current" />
                : <X size={12} strokeWidth={1.5} />
              }
            </button>
          </div>
        );
      })}
    </div>
  );
}
