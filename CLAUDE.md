# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Start full dev environment (launches Vite + Tauri window)
npm run tauri dev

# Frontend only (Vite on port 1420, no native window)
npm run dev

# TypeScript check
npx tsc --noEmit

# Production desktop app build
npm run tauri build
```

## Architecture

**thought-flow** is a Tauri 2 desktop app — React/TypeScript frontend bundled by Vite, Rust backend exposed via Tauri's IPC bridge.

### Frontend (`src/`)
- Entry: `index.html` → `src/main.tsx` → `src/App.tsx`
- Stack: React 19, TypeScript 5.8, Vite 7, Tailwind CSS v4
- Dev server runs on port 1420 (HMR on 1421)
- Path alias: `@` → `./src`
- `main.tsx` must import `./index.css` for Tailwind and CSS variables to load

### Backend (`src-tauri/`)
- Entry: `src-tauri/src/main.rs` → `thought_flow_lib::run()`
- App identifier: `com.mash.thought-flow`
- Window starts maximized with `decorations: false` — `TitleBar` handles drag, minimize, maximize, close
- Tauri capabilities in `src-tauri/capabilities/default.json`: explicit window + fs permissions, fs scoped to `$HOME/Documents/thought-flow/**`

## Core Concept

Every file is a chat session stored in `~/Documents/thought-flow/` with a two-part format:

```
[{"role":"user","content":"...","timestamp":0},...]
[+]
{"meta":{"type":"flowchart",...},"nodes":[...],"edges":[...],"styles":{...},"extensions":{}}
```

- Part 1: JSON array of `ChatMessage` objects
- Part 2: `ChartGraph` JSON (absent/empty on new files)
- Delimiter: `\n[+]\n`

## State Management

| Store | File | Persisted | Purpose |
|-------|------|-----------|---------|
| `useTabStore` | `store/tabStore.ts` | No | Tabs, messages, chart state, load/save |
| `useSettingsStore` | `store/settingsStore.ts` | `thought-flow-settings` | Theme, color mode, LLM config |
| `useLayoutStore` | `store/layoutStore.ts` | `thought-flow-layout` | Sidebar/chat widths and open state |
| `useStreamingStore` | `store/streamingStore.ts` | No | Global `isStreaming` flag for renderers |

**`useSettingsStore`** holds the multi-provider LLM config: `llmProvider` (`"ollama" | "openai" | "anthropic"`), `llmUrl`, `llmModel`, `llmApiKey`.

**`useTabStore`** key mutations:
- `setChart(path, chart)` — replace full chart
- `renameNode(path, nodeId, newText)` — mutates a node's text, re-serializes chart to last assistant message so the patcher sees the rename, then auto-saves
- `renameEdge(path, from, to, currentLabel, newLabel)` — same pattern for edge labels; matches first edge with `from + to + currentLabel`
- Both rename actions sync the last assistant message (`content.includes("graph ")` guard) so subsequent LLM edits don't revert manual renames

## UI Components

### Layout
- `TitleBar` — fixed 42px header: left (sidebar/files/settings), center (`TabBar`), right (chat toggle, theme, window controls)
- `TabBar` — rendered inside TitleBar; tabs sourced from `tabStore`
- `Sidebar` — left panel, resizable via `layoutStore.sidebarWidth` (160–480px)
- `ChatPanel` — right panel, resizable via `layoutStore.chatWidth` (200–600px)
- `App.tsx` — renders active renderer inside `<main>`, with a `mermaid | custom` toggle button (top-right corner of canvas); wires `onRenameNode` and `onRenameEdge` to both renderers

### Theme system
- Built-in themes in `src/themes/index.ts`, each with `dark`/`light` token sets
- `applyTheme(key, mode)` swaps CSS vars on `document.documentElement` at runtime (not class-based)
- Called at module level in `App.tsx` before first render, and on rehydration in `settingsStore`
- AI-generated themes via `src/lib/themeGenerator.ts` — `generateAppThemeFromPrompt` runs two `completeLLM` passes (generation + contrast-fix); `generateChartThemeFromPrompt` generates chart-only tokens

### Tailwind CSS v4
`@tailwindcss/vite` plugin (not PostCSS). Semantic tokens (`background`, `foreground`, `primary`, etc.) mapped via `@theme inline` in `src/index.css`.

## Chart System (`src/lib/chart/types.ts`)

`ChartGraph` is the central data format:
- `meta.type: "flowchart"` — discriminator for future chart types
- `ChartNode`: `id`, `text`, `type`, `shape`, `styleClass`, `metadata`
- `ChartEdge`: `from`, `to`, `type`, `label`, `style`, `metadata`
- `node.text` is stored **without** surrounding quotes — `mermaidText()` adds quotes on serialization

## LLM Integration (`src/lib/llm.ts`)

Single entry point for all LLM providers:
- `streamLLM(messages, onChunk, signal?, currentChart?)` — streaming generation; passes `currentChart` to switch to patcher prompt
- `completeLLM(systemPrompt, messages, signal?, onChunk?)` — blocking single completion; optional `onChunk` lets callers observe tokens without breaking the blocking contract (used by quality pipeline for live canvas updates)
- Provider dispatch reads `useSettingsStore` at call time: `ollama`, `openai`, `anthropic`
- Each provider uses the same buffer-split-safe NDJSON/SSE pattern: accumulate into `buffer`, only process complete lines via `lines.pop()`
- Two system prompts: `FLOWCHART_SYSTEM_PROMPT` (new chart) and `buildPatcherPrompt(chart)` (edit mode)
- Node labels **must be quoted**: `n2["My Label"]` — enforced in system prompt

**Note:** `src/lib/ollama.ts` still exists as a legacy file but `llm.ts` is the active entry point used by `ChatPanel`.

## Chart Generation Pipeline

### Speed mode (live streaming)
```
streamLLM → onChunk → parseStreamingChart → setChart (live preview, new charts only)
         → full response → mermaidToChart → validateAndFix → setChart (final)
```
**Patch mode guard**: when `activeTab.chart` exists (editing), `isPatchMode = true` suppresses live preview during streaming — the existing chart stays on canvas until the final validated parse replaces it.

### Quality mode (`src/lib/chart/qualityPipeline.ts`)
Three sequential `completeLLM` calls, each builds on the previous:
1. **Generation** — draft chart from user request (uses `FLOWCHART_SYSTEM_PROMPT` or `buildPatcherPrompt`)
2. **Validation** — rewriter removes duplicate/hallucinated nodes, repairs coherence
3. **Enhancer** — improves shape semantics and edge labels without changing process logic
4. **Finalize** — `sanitizeMermaidSyntax → mermaidToChart → validateAndFix → chartToMermaid → re-parse`

`QualityPipelineInput` callbacks:
- `onProgress(message)` — stage label shown in chat ("🛠️ Generating…")
- `onStageStart(stage)` — resets per-stage accumulation in `ChatPanel`
- `onStreamChunk(token, stage)` — fired for every token; `ChatPanel` runs `parseStreamingChart` and calls `setChart` when node/edge count grows → live canvas updates within each stage
- `onIntermediateChart(chart, stage)` — fired after each stage with the finalized stage chart

### `mermaid.ts` — Mermaid ↔ ChartGraph
- `parseMermaidLine(line)` — regex-based, handles node defs, chained edges, labels, all 10 shapes
- Valid Mermaid ID guard: `/^[A-Za-z_][\w]*$/` — prevents partial-stream artifacts (e.g. `|`) becoming ghost nodes
- `mermaidToChart(text)` — full parse; placeholder nodes (where `text === id`) are overwritten when real definition arrives
- `chartToMermaid(chart)` — emits a custom `title:` line **not valid in mermaid.js** — strip it before passing to `MermaidRenderer`

### `streamParse.ts` — Incremental parse during streaming
- `parseStreamingChart(accumulated)` — re-parses full accumulated text on each call, returns `PartialChart | null`
- Triggers `setChart` only when node or edge count increases

### `validate.ts` — Structural validation + auto-fix
- Fixes: broken edge refs (remove), duplicate node IDs (suffix `_2`), missing start/end nodes (promote)
- Warns (no fix): decision nodes with <2 outgoing edges, orphaned nodes
- All fixes logged: `[validate] ...`

### `qualityPipeline.ts` — `sanitizeMermaidSyntax`
Pre-processes LLM output before parse: strips code fences, fixes malformed labeled edges (`-->|label|>n2`), splits multiple Mermaid statements accidentally emitted on one line.

## Renderers

Both renderers accept `onRenameNode(nodeId, newText)` and `onRenameEdge(from, to, currentLabel, newLabel)` props wired from `App.tsx`. Both prevent panning (`onPointerDown` returns early) when the click target is a node or edge label.

### Mermaid renderer (`src/components/MermaidRenderer.tsx`)
- `chartToMermaid(chart)` → strip `title:` line → `mermaid.render()` → inject SVG
- 300ms debounce on render (avoids floods during live streaming)
- During streaming: anchors bottom of SVG to 65% of viewport height at comfortable zoom
- After streaming: fit-to-view
- **Node editing**: `dblclick` DOM listener on container; walks up from target to `.node`, matches to chart node via `mermaidNodeMatches(el, n.id)`, positions HTML `<input>` overlay using `getBoundingClientRect()`
- **Edge label editing**: same `dblclick` listener walks to `.edgeLabel`, matches by `textContent === edge.label`, positions overlay; `.edgeLabel` excluded from pan start
- `EditingState` is a discriminated union `{ kind: "node" | "edge", ... }`

### Custom SVG renderer (`src/components/Flowchart/`)
- `layout.ts` — **Dagre layout** (`dagre` npm package). `isBack` detected as `dstNode.y < srcNode.y` (TB) or `dstNode.x < srcNode.x` (LR).
- `NodeShape.tsx` — 10 SVG shapes; accepts `onDoubleClick` prop (sets `cursor: text`)
- `EdgePath.tsx` — Catmull-Rom → Bézier curves with arrowheads; labeled edges have `data-edge-label` attribute and `onLabelDoubleClick(clientX, clientY)` prop; transparent hit-rect uses `pointerEvents="all"`
- `index.tsx` — pan (pointer capture), zoom (wheel toward cursor)
  - During streaming: follows the bottom-most node (max y) at scale 0.75, anchored to 65% of viewport height
  - After streaming: fit-to-view on first content, first edges, or >40% height growth
  - **Node editing**: `startEdit(nodeId, text)` sets `editingNodeId`; HTML `<input>` overlay positioned via `(node.x * scale + vp.x, node.y * scale + vp.y)`
  - **Edge editing**: `setEditingEdge({ from, to, currentLabel, value, screenX, screenY })`; overlay positioned at click coordinates; `[data-edge-label]` excluded from pan start

Both renderers read `useStreamingStore.isStreaming` to switch between follow-last-node and fit-to-view behavior.

## Sidebar / File Management

- Vault root: `~/Documents/thought-flow/` (created on first launch)
- `src/components/sidebar/FileExplorer.tsx` — manages vault state, mounts `ExplorerCtx`
- `src/components/sidebar/TreeNode.tsx` — file click calls `openTab`; folders lazy-load on expand
- `src/components/sidebar/dnd.ts` — pointer-based drag-and-drop (HTML5 DnD broken on WebKitGTK/Linux)
- `src/components/sidebar/ContextMenu.tsx` — right-click rename/delete/create

## Key Console Log Tags

| Tag | Source | Meaning |
|-----|--------|---------|
| `[pipeline] starting generation` | ChatPanel | New message sent |
| `[pipeline] final parse` | ChatPanel | Stream ended, parsing full Mermaid |
| `[pipeline] validate+fix:` | ChatPanel | Result of validateAndFix |
| `[pipeline] chart mode: patch` | ChatPanel | Editing an existing chart |
| `[quality:generation/validation/enhancer/finalize]` | qualityPipeline | Quality mode stage output |
| `[live] +N node(s)` | ChatPanel | Live preview chart update (speed mode, new charts only) |
| `[mermaid] rendered` | MermaidRenderer | mermaid.js render complete |
| `[mermaid] fit-to-view` | MermaidRenderer | Viewport auto-refitted |

## Gotchas

- `chartToMermaid` emits `title: ...` — mermaid.js rejects it. `MermaidRenderer.toMermaidJs()` strips it.
- Node labels must be double-quoted in Mermaid: `n2["Label"]`. The system prompt enforces this.
- `node.text` in `ChartGraph` does **not** include surrounding quotes — `mermaidText()` adds them on serialization.
- Speed mode live preview is suppressed in patch mode (`isPatchMode = !!(activeTab.chart)`). The existing chart stays visible until the final validated parse.
- `completeLLM` accepts an optional `onChunk` 4th arg — used by quality pipeline to stream tokens for live canvas updates per stage. Callers that don't need streaming can omit it.
- `renameNode` / `renameEdge` in `tabStore` update the last assistant message (if it contains `"graph "`) with the freshly serialized chart. This keeps the patcher prompt consistent and prevents LLM from reverting manual renames.
- Edge label double-click works by matching `edgeLabelEl.textContent.trim()` to `edge.label`. If two edges share the same label text, the first match wins.
- `[data-node]` and `[data-edge-label]` SVG attributes gate pan-start in the custom renderer. `[.node]` and `[.edgeLabel]` CSS classes gate pan-start in the Mermaid renderer.
