# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Start full dev environment (launches Vite + Tauri window)
npm run tauri dev

# Frontend only (Vite on port 1420, no native window)
npm run dev

# TypeScript check + production build
npm run build

# Production desktop app build
npm run tauri build
```

No lint or test scripts are configured yet.

## Architecture

**thought-flow** is a Tauri 2 desktop app — React/TypeScript frontend bundled by Vite, Rust backend exposed via Tauri's IPC bridge.

### Frontend (`src/`)
- Entry: `index.html` → `src/main.tsx` → `src/App.tsx`
- Stack: React 19, TypeScript 5.8, Vite 7, Tailwind CSS v4
- Dev server runs on port 1420 (HMR on 1421)
- Path alias: `@` → `./src`
- `main.tsx` must import `./index.css` for Tailwind and CSS variables to load

### Backend (`src-tauri/`)
- Entry: `src-tauri/src/main.rs` calls `thought_flow_lib::run()`
- Tauri builder and command registration live in `src-tauri/src/lib.rs`
- App identifier: `com.mash.thought-flow`
- Config: `src-tauri/tauri.conf.json`
- Window starts maximized with `decorations: false` — the custom `TitleBar` handles drag, minimize, maximize, and close via `@tauri-apps/api/window`

### Frontend ↔ Backend IPC
Rust functions annotated with `#[tauri::command]` are registered in `lib.rs` via `.invoke_handler(tauri::generate_handler![...])`. The frontend calls them with `invoke()` from `@tauri-apps/api/core`.

### Build pipeline
Tauri orchestrates the two build steps automatically via `beforeDevCommand`/`beforeBuildCommand` in `tauri.conf.json`. Do not invoke them out of order manually.

## UI System

### Theme & color mode
- Themes defined in `src/themes/index.ts` — 6 themes (Raven, Pluto, Moon, Mother Tree, Owl, Dawn), each with dark/light token sets
- `applyTheme(key, mode)` swaps CSS variables on `document.documentElement` at runtime — not class-based
- `useSettingsStore` (Zustand, persisted to localStorage as `"thought-flow-settings"`) holds the active theme and color mode
- `applyTheme` is called at module level in `App.tsx` before first render to avoid a flash of unstyled content
- Base CSS variables and Tailwind `@theme inline` mapping live in `src/index.css`

### Component layout
- `TitleBar` — fixed 42px header with sidebar toggle, chat toggle, settings (opens ThemeModal), theme toggle, and native window controls
- `Sidebar` — left panel, default 240px, resizable (160–480px) via drag handle on right edge
- `ChatPanel` — right panel, default 288px, resizable (200–600px) via drag handle on left edge; contains message list and textarea input with action bar
- `src/components/ui/` — `Button` (CVA variants) and `Dialog` (Radix UI)
- `src/lib/utils.ts` — `cn()` helper (clsx + tailwind-merge)

### Resizable panels
Both `Sidebar` and `ChatPanel` use the same pointer-based resize pattern: `onMouseDown` on a 4px edge handle attaches `mousemove`/`mouseup` to `document`, sets `cursor` and `userSelect` on `body` during drag, and clamps width between min/max constants defined at the top of each file.

### Sidebar / file management
- `FileExplorer.tsx` manages vault state and mounts the `ExplorerCtx` provider
- `TreeNode.tsx` renders files and folders recursively; folders are lazy-loaded on expand
- `dnd.ts` implements pointer-based drag-and-drop (HTML5 DnD is broken on WebKitGTK/Linux)
- `ContextMenu.tsx` handles right-click rename/delete/create; `inputs.tsx` handles inline create and rename inputs

### Chat
- `src/store/chatStore.ts` — Zustand store holding the message list (`id`, `role`, `content`, `timestamp`); not persisted
- `ChatPanel.tsx` — message list uses `flex-col-reverse` to keep newest at bottom; textarea auto-grows up to 160px; send on Enter, newline on Shift+Enter

### Tailwind CSS v4
Uses `@tailwindcss/vite` plugin (not PostCSS). Semantic color tokens (`background`, `foreground`, `primary`, etc.) are Tailwind utilities mapped via `@theme inline` to CSS vars.

## Tauri Capabilities
Window and fs permissions are explicitly listed in `src-tauri/capabilities/default.json`. Required window permissions: `allow-minimize`, `allow-toggle-maximize`, `allow-close`, `allow-is-maximized`, `allow-start-dragging`. File system access is scoped to `$HOME/Documents/thought-flow/**` via `fs:scope`.
