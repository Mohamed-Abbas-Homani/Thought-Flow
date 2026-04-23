import { useRef, useState } from "react";
import { Send, Trash2, Eye, EyeOff } from "lucide-react";
import { useTabStore, type ChatMessage } from "../store/tabStore";
import { streamLLM } from "../lib/llm";
import { mermaidToChart } from "../lib/chart/mermaid";
import { validateAndFix } from "../lib/chart/validate";
import { parseStreamingChart, partialToGraph } from "../lib/chart/streamParse";
import { cn } from "@/lib/utils";
import { useStreamingStore } from "../store/streamingStore";
import { useSettingsStore } from "../store/settingsStore";


const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

export function ChatPanel() {
  const { tabs, activeTabPath, addMessage, setChart, saveTab } = useTabStore();
  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;

  const [input, setInput]           = useState("");
  const [width, setWidth]           = useState(288);
  const { setIsStreaming } = useStreamingStore();
  const [streaming, setStreaming]   = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [livePreview, setLivePreview] = useState(false);
  
  const { llmModel, openSettings } = useSettingsStore();

  const bottomRef      = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const abortRef       = useRef<AbortController | null>(null);

  // Undo/redo history
  const historyRef      = useRef<string[]>([""]);
  const historyIndexRef = useRef(0);

  // Refs for stable access inside stream callbacks
  const livePreviewRef   = useRef(livePreview);
  const activeTabPathRef = useRef(activeTabPath);
  livePreviewRef.current   = livePreview;
  activeTabPathRef.current = activeTabPath;

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX     = e.clientX;
    const startWidth = width;

    function onMouseMove(ev: MouseEvent) {
      const delta = startX - ev.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
    }
    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function applyHistoryValue(value: string) {
    setInput(value);
    // Resize after React re-renders
    requestAnimationFrame(resizeTextarea);
  }

  function undo() {
    const idx = historyIndexRef.current;
    if (idx > 0) {
      historyIndexRef.current = idx - 1;
      applyHistoryValue(historyRef.current[historyIndexRef.current]);
    }
  }

  function redo() {
    const idx = historyIndexRef.current;
    if (idx < historyRef.current.length - 1) {
      historyIndexRef.current = idx + 1;
      applyHistoryValue(historyRef.current[historyIndexRef.current]);
    }
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || !activeTabPath || streaming) return;

    setInput("");
    historyRef.current = [""];
    historyIndexRef.current = 0;
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const userMsg: ChatMessage = { role: "user", content: text, timestamp: Date.now() };
    addMessage(activeTabPath, userMsg);

    const history = [
      ...(activeTab?.messages ?? []),
      userMsg,
    ].map(({ role, content }) => ({ role, content }));

    setStreaming(true);
    setIsStreaming(true);
    setStreamingText("");
    abortRef.current = new AbortController();

    console.log(`[pipeline] starting generation — live-preview=${livePreviewRef.current}, tab=${activeTabPath}`);

    let accumulated = "";
    let lastNodeCount = 0;
    let lastEdgeCount = 0;
    let full = "";
    try {
      full = await streamLLM(
        history,
        (token) => {
          accumulated += token;
          setStreamingText((t) => t + token);
          bottomRef.current?.scrollIntoView({ behavior: "instant" });

          // Enhancement 1: live progressive Mermaid parse (line-by-line streaming)
          if (livePreviewRef.current && activeTabPathRef.current) {
            const partial = parseStreamingChart(accumulated);
            if (partial) {
              const { nodes, edges } = partial;
              if (nodes.length > lastNodeCount || edges.length > lastEdgeCount) {
                console.log(`[live] +${nodes.length - lastNodeCount} node(s), +${edges.length - lastEdgeCount} edge(s) → ${nodes.length} nodes, ${edges.length} edges @ ${accumulated.length} chars`);
                lastNodeCount = nodes.length;
                lastEdgeCount = edges.length;
                setChart(activeTabPathRef.current, partialToGraph(partial));
              }
            }
          }
        },
        abortRef.current.signal
      );
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (!isAbort) {
        full = `[Error contacting LLM: ${err instanceof Error ? err.message : String(err)}]`;
        setStreamingText(full);
      }
    }

    setStreaming(false);
    setIsStreaming(false);
    setStreamingText("");

    // Enhancement 1+2: Final Mermaid parse + structural validation/auto-fix
    // Extract Mermaid from response — handle optional code fences gracefully
    const fenceMatch = full.match(/```(?:mermaid)?\s*\n([\s\S]*?)```/);
    const mermaidText = fenceMatch ? fenceMatch[1] : full;

    if (mermaidText.trim().startsWith("graph ")) {
      console.log(`[pipeline] final parse — ${mermaidText.length} chars${fenceMatch ? " (extracted from code fence)" : ""}`);
      try {
        const { fixed, issues } = validateAndFix(mermaidToChart(mermaidText));
        console.log(`[pipeline] validate+fix: ${issues.length === 0 ? "clean" : issues.join("; ")} → ${fixed.nodes.length} nodes, ${fixed.edges.length} edges`);

        // Enhancement 3: patcher mode — log when editing vs creating
        const hadChart = !!(tabs.find(t => t.path === activeTabPath)?.chart);
        console.log(`[pipeline] chart mode: ${hadChart ? "patch (editing existing)" : "generate (new chart)"}`);

        setChart(activeTabPath, fixed);
      } catch (err) {
        console.warn("[pipeline] final parse failed:", err);
      }
    } else {
      console.warn(`[pipeline] response does not look like Mermaid — first 80 chars: ${full.slice(0, 80).replace(/\n/g, "\\n")}`);
    }

    const assistantMsg: ChatMessage = { role: "assistant", content: full, timestamp: Date.now() };
    addMessage(activeTabPath, assistantMsg);
    await saveTab(activeTabPath);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInput(val);
    resizeTextarea();

    // Push to undo history (truncate redo branch)
    const prev = historyRef.current.slice(0, historyIndexRef.current + 1);
    prev.push(val);
    historyRef.current = prev;
    historyIndexRef.current = prev.length - 1;
  }

  async function clearChat() {
    if (!activeTabPath) return;
    useTabStore.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === activeTabPath ? { ...t, messages: [], chart: null, isDirty: true } : t
      ),
    }));
    await saveTab(activeTabPath);
  }

  const messages = activeTab?.messages ?? [];

  return (
    <div style={{ width }} className="flex flex-col h-full border-l border-[color-mix(in_srgb,var(--background)_82%,black_18%)] shrink-0 relative">
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-ring/40 transition-colors z-10"
      />

      {/* Header */}
      <div className="h-[42px] flex items-center justify-between px-3 shrink-0 border-b border-[color-mix(in_srgb,var(--background)_82%,black_18%)]">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest">
          {activeTab ? activeTab.name : "Chat"}
        </span>
        {messages.length > 0 && (
          <button
            title="Clear chat"
            onClick={clearChat}
            className="p-1 text-muted-foreground hover:text-foreground rounded cursor-default transition-colors"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto py-3 px-3 flex flex-col-reverse gap-3">
        <div ref={bottomRef} />

        {streaming && (
          <div className="flex flex-col gap-1 max-w-[90%] self-start items-start">
            <div className="px-3 py-2 rounded-lg text-[13px] leading-relaxed whitespace-pre-wrap break-words bg-secondary text-secondary-foreground">
              {streamingText || <span className="text-muted-foreground italic text-[12px]">Thinking…</span>}
            </div>
          </div>
        )}

        {!activeTab && (
          <p className="text-muted-foreground/50 text-[12px] italic text-center mt-8 select-none">
            Select or create a file to start chatting
          </p>
        )}

        {activeTab && messages.length === 0 && !streaming && (
          <p className="text-muted-foreground/50 text-[12px] italic text-center mt-8 select-none">
            No messages yet
          </p>
        )}

        {[...messages].reverse().map((msg) => (
          <div
            key={msg.timestamp}
            className={cn(
              "flex flex-col gap-1 max-w-[90%]",
              msg.role === "user" ? "self-end items-end" : "self-start items-start"
            )}
          >
            <div
              className={cn(
                "px-3 py-2 rounded-lg text-[13px] leading-relaxed whitespace-pre-wrap break-words",
                msg.role === "user"
                  ? "bg-ring text-background"
                  : "bg-secondary text-secondary-foreground"
              )}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="shrink-0 p-3">
        <form
          onSubmit={handleSubmit}
          className={cn(
            "rounded-lg border transition-colors bg-primary",
            activeTab ? "border-border focus-within:border-ring" : "border-border opacity-50 pointer-events-none"
          )}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={activeTab ? "Message…" : "Open a file to chat"}
            disabled={!activeTab || streaming}
            rows={1}
            className="w-full resize-none bg-transparent text-foreground text-[13px] placeholder:text-muted-foreground px-3 pt-2.5 pb-1 outline-none leading-relaxed overflow-y-auto disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                title={livePreview ? "Live preview on" : "Live preview off"}
                onClick={() => setLivePreview((v) => !v)}
                className={cn(
                  "p-1 rounded cursor-default transition-colors",
                  livePreview ? "text-ring" : "text-muted-foreground/40 hover:text-muted-foreground"
                )}
              >
                {livePreview ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>

              <button 
                type="button"
                onClick={() => openSettings("model")}
                className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer outline-none px-1"
                title="Change Model/URL Endpoint"
              >
                {llmModel}
              </button>
            </div>

            <button
              type="submit"
              disabled={!input.trim() || !activeTab || streaming}
              title="Send"
              className="h-7 w-7 flex items-center justify-center rounded-md bg-ring text-background disabled:opacity-30 hover:opacity-90 disabled:hover:opacity-30 transition-opacity cursor-default"
            >
              <Send size={13} strokeWidth={1.8} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
