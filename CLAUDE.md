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

Every file is a chat session. Files are stored in `~/Documents/thought-flow/` with a two-part format:

```
[{"role":"user","content":"...","timestamp":0},...]
[+]
{"meta":{"type":"flowchart",...},"nodes":[...],"edges":[...],"styles":{...},"extensions":{}}
```

- Part 1: JSON array of `ChatMessage` objects
- Part 2: `ChartGraph` JSON (absent/empty on new files)
- Delimiter: `\n[+]\n`

Clicking a file in the sidebar opens it as a tab. The canvas shows the chart; the chat panel shows the conversation. Sending a message streams to Ollama which returns Mermaid; the canvas updates and the file is auto-saved.

## State Management

**`src/store/tabStore.ts`** — single source of truth (Zustand, not persisted):
- `tabs: Tab[]` — each tab holds `path`, `name`, `messages`, `chart`, `isDirty`
- `openTab(path, name)` — reads file, parses both parts, adds tab
- `addMessage / setChart / saveTab` — mutate tab state and write to disk
- `closeTab` — removes tab, switches to adjacent

**`src/store/settingsStore.ts`** — theme + color mode (Zustand, persisted to localStorage as `"thought-flow-settings"`)

## UI Components

### Layout
- `TitleBar` — fixed 42px header: left (sidebar/files/settings), center (`TabBar`), right (chat toggle, theme, window controls)
- `TabBar` — rendered inside TitleBar center; tabs sourced from `tabStore`
- `Sidebar` — left panel, default 240px, resizable 160–480px (drag handle on right edge)
- `ChatPanel` — right panel, default 288px, resizable 200–600px (drag handle on left edge)
- `App.tsx` renders `<Flowchart key={activeTab.path} chart={activeTab.chart} />` in the main area (key forces remount on tab switch, triggering fit-to-view)

### Resizable panels
Both panels use the same pointer pattern: `onMouseDown` on a 4px edge handle → attach `mousemove`/`mouseup` to `document`, set `cursor`/`userSelect` on body, clamp to min/max.

### Theme system
- 6 themes in `src/themes/index.ts` (Raven, Pluto, Moon, Mother Tree, Owl, Dawn), each with `dark`/`light` token sets
- `applyTheme(key, mode)` swaps CSS vars on `document.documentElement` at runtime (not class-based)
- Called at module level in `App.tsx` before first render to avoid flash

### Tailwind CSS v4
`@tailwindcss/vite` plugin (not PostCSS). Semantic tokens (`background`, `foreground`, `primary`, etc.) mapped via `@theme inline` in `src/index.css`.

## Chart System (`src/lib/chart/types.ts`)

`ChartGraph` is the extensible chart data format:
- `meta.type: "flowchart"` — discriminator for future chart types (timeline, mindmap, etc.)
- `ChartNode`: `id`, `text`, `type`, `shape`, `styleClass`, `metadata`
- `ChartEdge`: `from`, `to`, `type`, `label`, `style`, `metadata`

### Flowchart renderer (`src/components/Flowchart/`)
- `layout.ts` — Sugiyama hierarchical layout (BFS rank assignment, barycenter sort, pixel coordinate placement). Logs `[layout] computeLayout`, `[layout] ranks`, `[layout] fit-to-view triggered`.
- `NodeShape.tsx` — 10 SVG shapes (rounded-rect, rect, diamond, parallelogram, hexagon, subroutine, cylinder, double-circle, flag, stadium)
- `EdgePath.tsx` — Catmull-Rom → Bézier curves with arrowheads; back edges (type=loop/jump) routed around the left margin
- `index.tsx` — pan (pointer capture), zoom (wheel toward cursor). Auto-fits when: first nodes arrive, first edges arrive (important: nodes can precede edges in live preview), or chart height grows >40%.

## Ollama Integration (`src/lib/ollama.ts`)

- Model: `llama3.1:8b` at `http://localhost:11434/api/chat` with `stream: true`, `temperature: 0`
- Streams NDJSON (buffer-split-safe: accumulate into `buffer`, only process complete lines via `lines.pop()`)
- Two system prompts: `FLOWCHART_SYSTEM_PROMPT` (new chart) and `buildPatcherPrompt(chart)` (edit existing)
- Both prompts request **Mermaid** output, not JSON — ~10× fewer tokens than JSON for the same chart
- Logs: `[ollama] mode=generator|patcher`, `[ollama] input messages:`, `[ollama] full response:`

## Chart Generation Pipeline (`src/lib/chart/`)

The model outputs Mermaid; the pipeline converts it to `ChartGraph`:

```
Ollama stream → (Enhancement 1) line-by-line Mermaid parse → PartialChart → setChart (live)
                                                                                    ↓
Ollama done  → extract Mermaid (strip code fences) → mermaidToChart → (Enhancement 2) validateAndFix → setChart (final)
```

### `mermaid.ts` — Mermaid ↔ ChartGraph
- `parseMermaidLine(line)` — regex-based, handles node defs, edges (chained), labels, all 10 shapes
- `mermaidToChart(text)` — full parse; placeholder nodes overwritten when real definition arrives (`existing.text === n.id` guard)
- `chartToMermaid(chart)` — used by patcher prompt to give the model the current chart as compact Mermaid context
- Logs: `[mermaid] line "..." → N node(s), N edge(s)`

### `streamParse.ts` — Incremental parse during streaming
- `parseStreamingChart(accumulated)` — re-parses full accumulated text each call, returns `PartialChart | null`
- Same placeholder-overwrite guard as `mermaid.ts`
- Used by live preview in `ChatPanel` — only triggers `setChart` when node or edge count increases

### `validate.ts` — Structural validation + auto-fix
- `validateAndFix(chart)` — run after every final parse before `setChart`
- Fixes: broken edge refs (remove), duplicate node IDs (suffix _2), missing start node (promote), missing end node (promote)
- Warns: decision nodes with <2 outgoing edges, orphaned nodes
- All fixes logged: `[validate] ...`

### Pipeline logs to watch in console
| Tag | Meaning |
|-----|---------|
| `[pipeline] starting generation` | New message sent |
| `[pipeline] final parse` | Stream ended, parsing full Mermaid |
| `[pipeline] validate+fix: clean` | Chart is structurally valid |
| `[pipeline] chart mode: patch` | Editing an existing chart |
| `[pipeline] response does not look like Mermaid` | Model output unexpected |
| `[live] +N node(s), +N edge(s)` | Live preview updating chart |
| `[mermaid] line "..."` | Each parsed line during final parse |
| `[layout] computeLayout` | Layout engine input |
| `[layout] ranks: n1=r0, n2=r1, ...` | BFS rank assignment result |
| `[layout] fit-to-view triggered` | Viewport auto-refitted |
| `[ollama] mode=generator\|patcher` | Which system prompt was used |

## Sidebar / File Management

- Vault root: `~/Documents/thought-flow/` (created on first launch)
- `FileExplorer.tsx` — manages vault state, mounts `ExplorerCtx`
- `TreeNode.tsx` — file click calls `openTab`; folders lazy-load on expand
- `dnd.ts` — pointer-based drag-and-drop (HTML5 DnD broken on WebKitGTK/Linux)
- `ContextMenu.tsx` — right-click rename/delete/create
