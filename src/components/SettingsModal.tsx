import { useState, useEffect } from "react";
import { Sun, Moon, Check, Palette, Cpu, X } from "lucide-react";
import { themes, type ColorMode } from "@/themes";
import { useSettingsStore, type SettingsSection } from "@/store/settingsStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COLOR_MODES: { key: ColorMode; label: string; icon: React.ReactNode }[] = [
  { key: "light", label: "Light", icon: <Sun size={15} strokeWidth={1.5} /> },
  { key: "dark",  label: "Dark",  icon: <Moon size={15} strokeWidth={1.5} /> },
];

export function SettingsModal() {
  const { 
    isSettingsOpen, 
    activeSection, 
    closeSettings, 
    openSettings,
    theme, 
    colorMode, 
    setTheme, 
    setColorMode,
    llmProvider,
    llmUrl,
    llmModel,
    llmApiKey,
    setLLMConfig
  } = useSettingsStore();

  const sections: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    { id: "theme", label: "Appearance", icon: <Palette size={16} /> },
    { id: "model", label: "LLM Model", icon: <Cpu size={16} /> },
  ];

  return (
    <Dialog open={isSettingsOpen} onOpenChange={(o) => { if (!o) closeSettings(); }}>
      <DialogContent className="max-w-[720px] p-0 overflow-hidden h-[520px] !flex !flex-row gap-0 border-none">
        {/* Sidebar */}
        <div className="w-[200px] border-r border-border/50 bg-secondary/20 flex flex-col pt-6 shrink-0 h-full">
          <div className="px-5 mb-6">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 select-none">
              Settings
            </h2>
          </div>
          <nav className="flex-1 px-2.5 space-y-0.5">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => openSettings(s.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 cursor-default group",
                  activeSection === s.id 
                    ? "bg-secondary text-secondary-foreground font-semibold shadow-sm" 
                    : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                )}
              >
                <span className={cn(
                  "transition-colors",
                  activeSection === s.id ? "text-ring" : "text-muted-foreground/60 group-hover:text-foreground"
                )}>
                  {s.icon}
                </span>
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
          <div className="flex-1 overflow-y-auto px-10 py-8">
            {activeSection === "theme" && (
              <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <section>
                  <div className="flex flex-col gap-1 mb-5">
                    <h3 className="text-sm font-semibold tracking-tight">Appearance</h3>
                    <p className="text-[12px] text-muted-foreground">Customize how the application looks and feels.</p>
                  </div>
                  
                  <div className="flex gap-2 p-1 bg-secondary/30 rounded-xl w-fit">
                    {COLOR_MODES.map(({ key, label, icon }) => (
                      <button
                        key={key}
                        onClick={() => setColorMode(key)}
                        className={cn(
                          "flex items-center gap-2 px-6 py-2 rounded-lg text-xs font-medium transition-all duration-200 cursor-default",
                          colorMode === key 
                            ? "bg-background text-foreground shadow-sm ring-1 ring-border" 
                            : "text-muted-foreground hover:text-foreground hover:bg-background/20"
                        )}
                      >
                        {icon}
                        {label}
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="flex flex-col gap-1 mb-5">
                    <h3 className="text-sm font-semibold tracking-tight">Active Theme</h3>
                    <p className="text-[12px] text-muted-foreground">Choose a curated palette for your flowcharts.</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    {Object.entries(themes).map(([key, t]) => {
                      const tokens = t[colorMode];
                      const isSelected = theme === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setTheme(key)}
                          className={cn(
                            "group relative rounded-xl border-2 p-4 text-left transition-all duration-200 focus:outline-none",
                            isSelected 
                              ? "border-ring bg-secondary/20 shadow-md translate-y-[-2px]" 
                              : "border-transparent bg-secondary/10 hover:border-muted-foreground/20 hover:bg-secondary/20",
                          )}
                        >
                          <div className="flex gap-1.5 mb-4">
                            {t.palette.map((color, i) => (
                              <span key={i} className="h-3.5 flex-1 rounded shadow-sm transition-transform group-hover:scale-105" style={{ backgroundColor: color }} />
                            ))}
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-foreground text-[12px] font-bold tracking-tight">{t.name}</span>
                            {isSelected && (
                              <div className="flex items-center justify-center h-4 w-4 rounded-full bg-ring shadow-sm">
                                <Check size={10} className="text-background stroke-[3]" />
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}

            {activeSection === "model" && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex flex-col gap-1 border-b border-border pb-6">
                  <h3 className="text-sm font-semibold tracking-tight">Intelligence Engine</h3>
                  <p className="text-[12px] text-muted-foreground">Configure the LLM powering your diagram generations.</p>
                </div>

                <div className="grid gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 px-1">AI Provider</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["ollama", "openai", "anthropic"] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setLLMConfig({ llmProvider: p })}
                          className={cn(
                            "flex flex-col items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all duration-200 cursor-default capitalize text-xs font-semibold",
                            llmProvider === p 
                              ? "border-ring bg-secondary/30 text-foreground" 
                              : "border-transparent bg-secondary/10 text-muted-foreground hover:bg-secondary/20 hover:text-foreground"
                          )}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 px-1">Base API URL</label>
                    <input 
                      type="text" 
                      value={llmUrl || ""} 
                      onChange={(e) => setLLMConfig({ llmUrl: e.target.value })}
                      className="w-full bg-secondary/10 border-2 border-transparent rounded-xl px-4 py-2.5 text-sm text-foreground outline-none focus:border-ring/40 focus:bg-background transition-all placeholder:text-muted-foreground/50"
                      placeholder={llmProvider === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1"}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 px-1">Model Name</label>
                    <input 
                      type="text" 
                      value={llmModel || ""} 
                      onChange={(e) => setLLMConfig({ llmModel: e.target.value })}
                      className="w-full bg-secondary/10 border-2 border-transparent rounded-xl px-4 py-2.5 text-sm text-foreground outline-none focus:border-ring/40 focus:bg-background transition-all placeholder:text-muted-foreground/50"
                      placeholder={llmProvider === "ollama" ? "qwen3:14b" : llmProvider === "openai" ? "gpt-4o" : "claude-3-5-sonnet-latest"}
                    />
                  </div>

                  {(llmProvider === "openai" || llmProvider === "anthropic") && (
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 px-1">API Key</label>
                      <input 
                        type="password" 
                        value={llmApiKey || ""} 
                        onChange={(e) => setLLMConfig({ llmApiKey: e.target.value })}
                        className="w-full bg-secondary/10 border-2 border-transparent rounded-xl px-4 py-2.5 text-sm text-foreground outline-none focus:border-ring/40 focus:bg-background transition-all"
                        placeholder="sk-..."
                      />
                    </div>
                  )}

                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

