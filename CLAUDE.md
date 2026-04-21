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

Clicking a file in the sidebar opens it as a tab. The canvas shows the chart; the chat panel shows the conversation. Sending a message streams to Ollama which returns a `ChartGraph`; the canvas updates and the file is auto-saved.

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
Ported from mkdgms with UIG→ChartGraph rename:
- `layout.ts` — Sugiyama hierarchical layout (BFS rank assignment, barycenter sort, pixel coordinate placement)
- `NodeShape.tsx` — 10 SVG shapes (rounded-rect, rect, diamond, parallelogram, hexagon, subroutine, cylinder, double-circle, flag, stadium)
- `EdgePath.tsx` — Catmull-Rom → Bézier curves with arrowheads; back edges (loop/jump) routed around the left margin
- `index.tsx` — pan (pointer capture), zoom (wheel toward cursor), fit-to-view on first render; `key={activeTab.path}` in App forces remount on tab switch

## Ollama Integration (`src/lib/ollama.ts`)

- Model: `llama3.1:8b` at `http://localhost:11434/api/chat` with `stream: true`
- Streams NDJSON, accumulates tokens, calls `onChunk` per token
- System prompt instructs the model to respond ONLY with a valid `ChartGraph` JSON
- Logs input messages and full response to console (`[ollama] input messages:` / `[ollama] full response:`)
- On stream end, `ChatPanel` tries `JSON.parse` of the full response — if valid `ChartGraph`, calls `setChart`; then saves the file

## Sidebar / File Management

- Vault root: `~/Documents/thought-flow/` (created on first launch)
- `FileExplorer.tsx` — manages vault state, mounts `ExplorerCtx`
- `TreeNode.tsx` — file click calls `openTab`; folders lazy-load on expand
- `dnd.ts` — pointer-based drag-and-drop (HTML5 DnD broken on WebKitGTK/Linux)
- `ContextMenu.tsx` — right-click rename/delete/create
