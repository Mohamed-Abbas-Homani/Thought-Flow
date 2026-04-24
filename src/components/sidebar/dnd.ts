/**
 * Pointer-based drag and drop for WebKitGTK (Tauri/Linux).
 * The HTML5 DnD API is broken on WebKitGTK — drag sessions cancel immediately.
 * This module uses mousemove/mouseup to implement the same behaviour.
 */

import { rename } from "@tauri-apps/plugin-fs";
import { useTabStore } from "../../store/tabStore";
import type { FsEntry } from "./types";

// ─── Module-level state ───────────────────────────────────────────────────────

let _src: FsEntry | null = null;
let _refreshSrcParent: (() => void) | null = null;
let _setDragging: ((e: FsEntry | null) => void) | null = null;

let _ghost: HTMLElement | null = null;
let _dragging = false;         // true once movement threshold is crossed
let _justDragged = false;      // suppresses the click that fires after mouseup

const THRESHOLD = 6; // px before drag "starts" visually
let _startX = 0;
let _startY = 0;

// Registry: folder path → its setIsDragOver setter
const _dropTargets = new Map<string, (v: boolean) => void>();
let _activeTarget: string | null = null;

// Registry: folder path → refresh-children callback (registered when expanded)
const _folderRefresh = new Map<string, () => void>();

// ─── Public API ───────────────────────────────────────────────────────────────

/** Folders call this on mount to become valid drop targets. */
export function registerDropTarget(path: string, setter: (v: boolean) => void) {
  _dropTargets.set(path, setter);
}

/** Folders call this on unmount. */
export function unregisterDropTarget(path: string) {
  _dropTargets.delete(path);
}

/** Expanded folders register their silent refresh so a drop into them updates the view. */
export function registerFolderRefresh(path: string, refresh: () => void) {
  _folderRefresh.set(path, refresh);
}

export function unregisterFolderRefresh(path: string) {
  _folderRefresh.delete(path);
}

/**
 * Call from the row's onMouseDown.
 * refreshParent — the callback that refreshes the folder containing this entry
 * (reloadVault for root-level nodes, refreshChildren of parent for nested nodes).
 */
export function startDrag(
  entry: FsEntry,
  setDragging: (e: FsEntry | null) => void,
  refreshParent: () => void,
  startX: number,
  startY: number
) {
  _src = entry;
  _setDragging = setDragging;
  _refreshSrcParent = refreshParent;
  _dragging = false;
  _justDragged = false;
  _startX = startX;
  _startY = startY;

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
}

/**
 * Check (and consume) the "just finished a drag" flag.
 * Call inside onClick handlers to ignore the click that follows a drag.
 */
export function consumeJustDragged(): boolean {
  if (_justDragged) { _justDragged = false; return true; }
  return false;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function onMouseMove(e: MouseEvent) {
  if (!_src) return;

  if (!_dragging) {
    const dx = e.clientX - _startX;
    const dy = e.clientY - _startY;
    if (Math.sqrt(dx * dx + dy * dy) < THRESHOLD) return;
    // Threshold crossed — begin visual drag
    _dragging = true;
    _setDragging?.(_src);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    _ghost = createGhost(_src.name, e.clientX, e.clientY);
  }

  if (_ghost) {
    _ghost.style.left = `${e.clientX + 14}px`;
    _ghost.style.top  = `${e.clientY + 10}px`;
  }

  updateDropTarget(e.clientX, e.clientY);
}

async function onMouseUp(_e: MouseEvent) {
  if (!_src) { cleanup(); return; }

  const src = _src;
  const target = _activeTarget;
  const didDrag = _dragging;
  const refreshSrcParent = _refreshSrcParent;

  if (didDrag) _justDragged = true;
  cleanup();

  if (!didDrag || !target || !refreshSrcParent) return;

  const destPath = `${target}/${src.name}`;
  if (destPath === src.path) return; // dropped in own parent

  try {
    await rename(src.path, destPath);
    useTabStore.getState().updatePath(src.path, destPath, src.name);
    refreshSrcParent();
    _folderRefresh.get(target)?.();
  } catch (err) {
    console.error("[DND] Move failed:", err);
  }
}

function updateDropTarget(x: number, y: number) {
  if (!_src) return;

  // elementFromPoint ignores the ghost because it has pointer-events:none
  const el = document.elementFromPoint(x, y);
  const folderEl = el?.closest<HTMLElement>("[data-drop-folder]");
  const newTarget = folderEl?.dataset.dropFolder ?? null;

  if (newTarget === _activeTarget) return;

  // Clear old highlight
  if (_activeTarget) _dropTargets.get(_activeTarget)?.(false);

  if (newTarget) {
    const valid =
      newTarget !== _src.path &&
      !newTarget.startsWith(_src.path + "/");
    if (valid) {
      _dropTargets.get(newTarget)?.(true);
      _activeTarget = newTarget;
    } else {
      _activeTarget = null;
    }
  } else {
    _activeTarget = null;
  }
}

function cleanup() {
  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("mouseup", onMouseUp);
  document.body.style.userSelect = "";
  document.body.style.cursor = "";

  if (_ghost) { _ghost.remove(); _ghost = null; }
  if (_activeTarget) { _dropTargets.get(_activeTarget)?.(false); _activeTarget = null; }

  _setDragging?.(null);
  _refreshSrcParent = null;
  _src = null;
  _dragging = false;
}

function createGhost(name: string, x: number, y: number): HTMLElement {
  const el = document.createElement("div");
  el.textContent = name;
  el.style.cssText = `
    position: fixed;
    left: ${x + 14}px;
    top: ${y + 10}px;
    pointer-events: none;
    z-index: 9999;
    background: var(--secondary);
    color: var(--foreground);
    border: 1px solid var(--border);
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 13px;
    opacity: 0.92;
    white-space: nowrap;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--background) 70%, transparent);
  `;
  document.body.appendChild(el);
  return el;
}
