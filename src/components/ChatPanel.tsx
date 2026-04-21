import { useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { useTabStore, type ChatMessage } from "../store/tabStore";
import { streamOllama } from "../lib/ollama";
import type { ChartGraph } from "../lib/chart/types";
import { cn } from "@/lib/utils";

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

export function ChatPanel() {
  const { tabs, activeTabPath, addMessage, setChart, saveTab } = useTabStore();
  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;

  const [input, setInput]       = useState("");
  const [width, setWidth]       = useState(288);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef    = useRef<AbortController | null>(null);

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

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || !activeTabPath || streaming) return;

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Append user message
    const userMsg: ChatMessage = { role: "user", content: text, timestamp: Date.now() };
    addMessage(activeTabPath, userMsg);

    // Build message history for Ollama (user/assistant only)
    const history = [
      ...(activeTab?.messages ?? []),
      userMsg,
    ].map(({ role, content }) => ({ role, content }));

    // Stream from Ollama
    setStreaming(true);
    setStreamingText("");
    abortRef.current = new AbortController();

    let full = "";
    try {
      full = await streamOllama(
        history,
        (token) => {
          full += token;
          setStreamingText((t) => t + token);
          bottomRef.current?.scrollIntoView({ behavior: "instant" });
        },
        abortRef.current.signal
      );
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (!isAbort) {
        full = `[Error contacting Ollama: ${err instanceof Error ? err.message : String(err)}]`;
        setStreamingText(full);
      }
    }

    setStreaming(false);
    setStreamingText("");

    // Try to extract a ChartGraph from the response
    try {
      const parsed = JSON.parse(full) as ChartGraph;
      if (parsed?.meta?.type && parsed?.nodes) {
        setChart(activeTabPath, parsed);
      }
    } catch { /* not a valid chart — just a text reply */ }

    // Save assistant message and persist
    const assistantMsg: ChatMessage = { role: "assistant", content: full, timestamp: Date.now() };
    addMessage(activeTabPath, assistantMsg);
    await saveTab(activeTabPath);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function clearChat() {
    if (!activeTabPath) return;
    // Close and re-open won't clear disk — we need to reset state then save
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

      {/* Message list — flex-col-reverse keeps newest at bottom */}
      <div className="flex-1 overflow-y-auto py-3 px-3 flex flex-col-reverse gap-3">
        <div ref={bottomRef} />

        {/* Streaming bubble */}
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
            className="w-full resize-none bg-transparent text-foreground text-[13px] placeholder:text-muted-foreground px-3 pt-2.5 pb-1 outline-none leading-relaxed overflow-hidden disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-end px-2 pb-2">
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
