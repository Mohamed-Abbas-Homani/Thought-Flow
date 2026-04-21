import { useState, useCallback, useContext, useEffect } from "react";
import { mkdir, writeTextFile, rename } from "@tauri-apps/plugin-fs";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Loader2,
} from "lucide-react";

import { ExplorerCtx } from "./context";
import { useTabStore } from "../../store/tabStore";
import { RenameInput, InlineInput } from "./inputs";
import { listDir, dirOf } from "./utils";
import {
  startDrag,
  registerDropTarget,
  unregisterDropTarget,
  registerFolderRefresh,
  unregisterFolderRefresh,
  consumeJustDragged,
} from "./dnd";
import type { FsEntry, CreatingType } from "./types";

interface Props {
  entry: FsEntry;
  depth: number;
  onRefreshParent: () => void;
}

export function TreeNode({ entry, depth, onRefreshParent }: Props) {
  const { dragging, setDragging, showMenu } = useContext(ExplorerCtx);

  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<CreatingType>(null);
  const [renaming, setRenaming] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const indent = depth * 14 + 8;

  useEffect(() => {
    if (!entry.isDirectory) return;
    registerDropTarget(entry.path, setIsDragOver);
    return () => unregisterDropTarget(entry.path);
  }, [entry.path, entry.isDirectory]);

  const loadChildren = useCallback(async () => {
    setLoading(true);
    try {
      setChildren(await listDir(entry.path));
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [entry.path]);

  const refreshChildren = useCallback(async () => {
    try {
      setChildren(await listDir(entry.path));
    } catch { /* silent */ }
  }, [entry.path]);

  useEffect(() => {
    if (!entry.isDirectory || !expanded) {
      unregisterFolderRefresh(entry.path);
      return;
    }
    registerFolderRefresh(entry.path, refreshChildren);
    return () => unregisterFolderRefresh(entry.path);
  }, [entry.isDirectory, entry.path, expanded, refreshChildren]);

  const toggle = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) await loadChildren();
  }, [expanded, children, loadChildren]);

  async function handleCreate(name: string, type: CreatingType) {
    setCreating(null);
    try {
      const newPath = `${entry.path}/${name}`;
      if (type === "folder") await mkdir(newPath, { recursive: true });
      else await writeTextFile(newPath, "");
      if (!expanded) { setExpanded(true); await loadChildren(); }
      else await refreshChildren();
    } catch (err) {
      console.error("Create failed:", err);
    }
  }

  async function handleRename(newName: string) {
    setRenaming(false);
    const newPath = `${dirOf(entry.path)}/${newName}`;
    if (newPath === entry.path) return;
    try {
      await rename(entry.path, newPath);
      onRefreshParent();
    } catch (err) {
      console.error("Rename failed:", err);
    }
  }

  function openCtxMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    showMenu({
      x: e.clientX,
      y: e.clientY,
      entry,
      onRefresh: onRefreshParent,
      onStartRenaming: () => setRenaming(true),
      onStartCreating: entry.isDirectory
        ? (type) => {
            if (!expanded) { setExpanded(true); if (children === null) loadChildren(); }
            setCreating(type);
          }
        : undefined,
    });
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    startDrag(entry, setDragging, onRefreshParent, e.clientX, e.clientY);
  }

  const { openTab } = useTabStore();

  function handleFileClick() {
    if (!entry.isDirectory) openTab(entry.path, entry.name);
  }

  const isDraggingSelf = dragging?.path === entry.path;

  // ── File ───────────────────────────────────────────────────────────────────

  if (!entry.isDirectory) {
    return (
      <div
        onMouseDown={handleMouseDown}
        onClick={handleFileClick}
        onContextMenu={openCtxMenu}
        style={{ paddingLeft: indent + 22 }}
        className={`flex items-center gap-1.5 w-full h-[28px] text-foreground/70 hover:bg-primary/20 text-[15px] cursor-pointer select-none ${
          isDraggingSelf ? "opacity-40" : ""
        }`}
      >
        <FileText size={16} className="text-muted-foreground shrink-0 pointer-events-none" />
        {renaming ? (
          <RenameInput
            defaultValue={entry.name}
            onCommit={handleRename}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="truncate">{entry.name}</span>
        )}
      </div>
    );
  }

  // ── Folder ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div
        data-drop-folder={entry.path}
        onMouseDown={handleMouseDown}
        onContextMenu={openCtxMenu}
        className={`group flex items-center w-full h-[28px] select-none transition-colors ${
          isDragOver
            ? "bg-secondary/40 outline outline-1 outline-secondary"
            : "hover:bg-primary/20"
        } ${isDraggingSelf ? "opacity-40" : ""}`}
      >
        <button
          style={{ paddingLeft: indent }}
          className="flex items-center flex-1 h-full text-foreground/80 text-[15px] cursor-pointer overflow-hidden"
          onClick={() => {
            if (consumeJustDragged()) return;
            toggle();
          }}
        >
          <span className="w-5 flex items-center justify-center text-muted-foreground shrink-0">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="text-muted-foreground mr-1.5 shrink-0 pointer-events-none">
            {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          </span>
          {renaming ? (
            <RenameInput
              defaultValue={entry.name}
              onCommit={handleRename}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <span className="truncate">{entry.name}</span>
          )}
        </button>

        {!renaming && (
          <div className="hidden group-hover:flex items-center gap-0.5 pr-1 shrink-0">
            <button
              title="New File"
              className="p-0.5 text-muted-foreground hover:text-foreground rounded cursor-default"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (!expanded) { setExpanded(true); if (children === null) loadChildren(); }
                setCreating("file");
              }}
            >
              <FilePlus size={13} />
            </button>
            <button
              title="New Folder"
              className="p-0.5 text-muted-foreground hover:text-foreground rounded cursor-default"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (!expanded) { setExpanded(true); if (children === null) loadChildren(); }
                setCreating("folder");
              }}
            >
              <FolderPlus size={13} />
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <>
          {loading && (
            <div style={{ paddingLeft: indent + 24 }} className="flex items-center gap-1.5 h-[28px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              <span className="text-[12px]">Loading…</span>
            </div>
          )}

          {creating && (
            <InlineInput
              indent={indent + 24}
              icon={creating === "folder" ? <Folder size={13} /> : <FileText size={13} />}
              onCommit={(name) => handleCreate(name, creating)}
              onCancel={() => setCreating(null)}
            />
          )}

          {!loading &&
            children?.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                onRefreshParent={refreshChildren}
              />
            ))}

          {!loading && children?.length === 0 && !creating && (
            <div style={{ paddingLeft: indent + 24 }} className="flex items-center h-[28px] text-muted-foreground/60 text-[12px] italic">
              Empty
            </div>
          )}
        </>
      )}
    </>
  );
}
