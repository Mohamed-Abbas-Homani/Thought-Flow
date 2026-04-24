import { useEffect, useState } from "react";
import { Sun, Moon, Check, Palette, Cpu, Paintbrush, Trash2, WandSparkles } from "lucide-react";
import { themes, type ColorMode } from "@/themes";
import { useSettingsStore, type SettingsSection } from "@/store/settingsStore";
import { useTabStore } from "@/store/tabStore";
import { generateAppThemeFromPrompt, generateChartThemeFromPrompt } from "@/lib/themeGenerator";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const COLOR_MODES: { key: ColorMode; label: string; icon: React.ReactNode }[] = [
  { key: "light", label: "Light", icon: <Sun size={15} strokeWidth={1.5} /> },
  { key: "dark",  label: "Dark",  icon: <Moon size={15} strokeWidth={1.5} /> },
];

export function SettingsModal() {
  const [appThemePrompt, setAppThemePrompt] = useState("");
  const [chartPrompt, setChartPrompt] = useState("");
  const [generatingAppTheme, setGeneratingAppTheme] = useState(false);
  const [generatingChartTheme, setGeneratingChartTheme] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  const { 
    isSettingsOpen, 
    activeSection, 
    closeSettings, 
    openSettings,
    theme, 
    colorMode, 
    customThemes,
    chartThemePrompt,
    chartThemeTokens,
    setTheme, 
    setColorMode,
    addCustomTheme,
    deleteCustomTheme,
    setChartTheme,
    llmProvider,
    llmUrl,
    llmModel,
    llmApiKey,
    setLLMConfig
  } = useSettingsStore();
  const { activeTabPath, applyChartTheme } = useTabStore();

  const sections: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    { id: "theme", label: "Appearance", icon: <Palette size={16} /> },
    { id: "model", label: "LLM Model", icon: <Cpu size={16} /> },
    { id: "chartTheme", label: "Chart Theme", icon: <Paintbrush size={16} /> },
  ];

  const availableThemes = { ...themes, ...customThemes };

  useEffect(() => {
    if (activeSection === "chartTheme") {
      setChartPrompt(chartThemePrompt);
    }
    setThemeError(null);
  }, [activeSection, chartThemePrompt]);

  async function createAppTheme() {
    const prompt = appThemePrompt.trim();
    if (!prompt || generatingAppTheme) return;
    setThemeError(null);
    setGeneratingAppTheme(true);
    try {
      const generated = await generateAppThemeFromPrompt(prompt);
      addCustomTheme(generated);
      setAppThemePrompt("");
    } catch (err) {
      setThemeError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingAppTheme(false);
    }
  }

  async function createChartTheme() {
    const prompt = chartPrompt.trim();
    if (!prompt || generatingChartTheme) return;
    setThemeError(null);
    setGeneratingChartTheme(true);
    try {
      const generated = await generateChartThemeFromPrompt(prompt);
      setChartTheme(prompt, generated);
      if (activeTabPath) {
        await applyChartTheme(activeTabPath, generated);
      }
    } catch (err) {
      setThemeError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingChartTheme(false);
    }
  }

  async function resetChartTheme() {
    setThemeError(null);
    setChartPrompt("");
    setChartTheme("", null);

    const activeTheme = availableThemes[theme] ?? themes.raven;
    const tokens = activeTheme[colorMode] ?? activeTheme.dark;
    const chartTokens = {
      "chart-bg": tokens["chart-bg"],
      "chart-node-bg": tokens["chart-node-bg"],
      "chart-node-border": tokens["chart-node-border"],
      "chart-edge": tokens["chart-edge"],
      "chart-text": tokens["chart-text"],
    };

    if (activeTabPath) {
      await applyChartTheme(activeTabPath, chartTokens);
    }
  }

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
                    {Object.entries(availableThemes).map(([key, t]) => {
                      const isSelected = theme === key;
                      const isCustom = !!customThemes[key];
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
                          {isCustom && (
                            <span
                              role="button"
                              tabIndex={0}
                              title="Delete theme"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                deleteCustomTheme(key);
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" && e.key !== " ") return;
                                e.preventDefault();
                                e.stopPropagation();
                                deleteCustomTheme(key);
                              }}
                              className="absolute top-2 right-2 h-7 w-7 hidden group-hover:flex items-center justify-center rounded-md text-muted-foreground hover:text-error hover:bg-background/70 transition-colors cursor-default"
                            >
                              <Trash2 size={13} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section>
                  <div className="flex flex-col gap-1 mb-5">
                    <h3 className="text-sm font-semibold tracking-tight">Create Theme</h3>
                    <p className="text-[12px] text-muted-foreground">Describe a palette or paste colors to save a reusable app theme.</p>
                  </div>

                  <div className="space-y-3 rounded-xl bg-secondary/10 p-4">
                    <textarea
                      value={appThemePrompt}
                      onChange={(e) => setAppThemePrompt(e.target.value)}
                      rows={3}
                      className="w-full resize-none bg-background/70 border-2 border-transparent rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-ring/40 transition-all placeholder:text-muted-foreground/50"
                      placeholder='e.g. "modern graphite with cyan accents" or "#0f172a #38bdf8"'
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] text-muted-foreground">Generated themes are saved locally and appear in the theme grid.</p>
                      <button
                        type="button"
                        onClick={createAppTheme}
                        disabled={!appThemePrompt.trim() || generatingAppTheme}
                        className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-ring text-background px-3 py-2 text-xs font-semibold disabled:opacity-40 cursor-default"
                      >
                        <WandSparkles size={14} />
                        {generatingAppTheme ? "Creating..." : "Create"}
                      </button>
                    </div>
                    {themeError && (
                      <p className="text-[12px] text-error">{themeError}</p>
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeSection === "chartTheme" && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex flex-col gap-1 border-b border-border pb-6">
                  <h3 className="text-sm font-semibold tracking-tight">Chart Theme</h3>
                  <p className="text-[12px] text-muted-foreground">Generate viewer and chart colors without changing the rest of the app.</p>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 px-1">Theme Prompt</label>
                  <textarea
                    value={chartPrompt}
                    onChange={(e) => setChartPrompt(e.target.value)}
                    rows={5}
                    className="w-full resize-none bg-secondary/10 border-2 border-transparent rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-ring/40 focus:bg-background transition-all placeholder:text-muted-foreground/50"
                    placeholder='e.g. "modern dark chart with emerald nodes" or "background #09090b, text white, edge violet"'
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] text-muted-foreground">
                      Current: {chartThemePrompt || "Using the selected app theme"}
                    </p>
                    <div className="flex items-center gap-2">
                      {chartThemeTokens && (
                        <button
                          type="button"
                          onClick={resetChartTheme}
                          className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground cursor-default"
                        >
                          Reset
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={createChartTheme}
                        disabled={!chartPrompt.trim() || generatingChartTheme}
                        className="inline-flex items-center gap-2 rounded-lg bg-ring text-background px-3 py-2 text-xs font-semibold disabled:opacity-40 cursor-default"
                      >
                        <WandSparkles size={14} />
                        {generatingChartTheme ? "Generating..." : "Generate"}
                      </button>
                    </div>
                  </div>
                  {themeError && (
                    <p className="text-[12px] text-error">{themeError}</p>
                  )}
                </div>

                {chartThemeTokens && (
                  <div className="grid grid-cols-5 gap-2">
                    {Object.entries(chartThemeTokens).map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-border bg-secondary/10 p-2">
                        <div className="h-10 rounded-md border border-border/40" style={{ backgroundColor: value }} />
                        <div className="mt-2 text-[10px] text-muted-foreground truncate">{key}</div>
                        <div className="text-[10px] text-foreground font-mono">{value}</div>
                      </div>
                    ))}
                  </div>
                )}
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
