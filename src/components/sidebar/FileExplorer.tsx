import { useState, useEffect, useCallback, useMemo } from "react";
import { mkdir, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { documentDir, join } from "@tauri-apps/api/path";
import { FilePlus, FolderPlus, Folder, FileText, Loader2 } from "lucide-react";

import { ExplorerCtx } from "./context";
import { ContextMenu } from "./ContextMenu";
import { InlineInput } from "./inputs";
import { TreeNode } from "./TreeNode";
import { listDir, BORDER } from "./utils";
import {
  registerDropTarget,
  unregisterDropTarget,
  registerFolderRefresh,
  unregisterFolderRefresh,
} from "./dnd";
import type { FsEntry, CreatingType, CtxMenuDef } from "./types";

export function FileExplorerPanel() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<CreatingType>(null);
  const [dragging, setDragging] = useState<FsEntry | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuDef | null>(null);
  const [isRootDragOver, setIsRootDragOver] = useState(false);

  const loadVault = useCallback(async (path: string) => {
    setLoading(true);
    try {
      setEntries(await listDir(path));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshVault = useCallback(async (path: string) => {
    try {
      setEntries(await listDir(path));
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    (async () => {
      const docDir = await documentDir();
      const vault = await join(docDir, "thought-flow");
      if (!(await exists(vault))) await mkdir(vault, { recursive: true });
      setVaultPath(vault);
      await loadVault(vault);
    })();
  }, [loadVault]);

  const reloadVault = useCallback(() => {
    if (vaultPath) refreshVault(vaultPath);
  }, [vaultPath, refreshVault]);

  useEffect(() => {
    if (!vaultPath) return;
    registerDropTarget(vaultPath, setIsRootDragOver);
    registerFolderRefresh(vaultPath, () => refreshVault(vaultPath));
    return () => {
      unregisterDropTarget(vaultPath);
      unregisterFolderRefresh(vaultPath);
    };
  }, [vaultPath, refreshVault]);

  const ctxValue = useMemo(
    () => ({
      dragging,
      setDragging,
      reloadVault,
      showMenu: (menu: CtxMenuDef) => setCtxMenu(menu),
    }),
    [dragging, reloadVault],
  );

  async function handleCreate(name: string, type: CreatingType) {
    if (!vaultPath) return;
    setCreating(null);
    try {
      const newPath = `${vaultPath}/${name}`;
      if (type === "folder") await mkdir(newPath, { recursive: true });
      else await writeTextFile(newPath, "");
      await refreshVault(vaultPath);
    } catch (err) {
      console.error("Create failed:", err);
    }
  }

  return (
    <ExplorerCtx.Provider value={ctxValue}>
      <div
        className={`flex flex-col h-full overflow-hidden border-r ${BORDER}`}
      >
        {/* Header */}
        <div className="px-2 h-[42px] flex items-center justify-center gap-0.5 shrink-0">
          <button
            title="New File"
            className="p-1 text-muted-foreground hover:text-foreground rounded cursor-default transition-colors"
            onClick={() => setCreating("file")}
          >
            <FilePlus size={18} />
          </button>
          <button
            title="New Folder"
            className="p-1 text-muted-foreground hover:text-foreground rounded cursor-default transition-colors"
            onClick={() => setCreating("folder")}
          >
            <FolderPlus size={18} />
          </button>
        </div>

        {/* Tree */}
        <div
          data-drop-folder={vaultPath ?? undefined}
          className={`flex-1 overflow-y-auto overflow-x-hidden py-0.5 transition-colors ${
            isRootDragOver ? "bg-secondary/20" : ""
          }`}
        >
          {loading && (
            <div className="flex items-center gap-1.5 pl-4 h-[28px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              <span className="text-[12px]">Loading…</span>
            </div>
          )}

          {creating && vaultPath && (
            <InlineInput
              indent={8}
              icon={
                creating === "folder" ? (
                  <Folder size={13} />
                ) : (
                  <FileText size={13} />
                )
              }
              onCommit={(name) => handleCreate(name, creating)}
              onCancel={() => setCreating(null)}
            />
          )}

          {!loading &&
            entries?.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                onRefreshParent={reloadVault}
              />
            ))}

          {!loading && entries?.length === 0 && !creating && (
            <div className="flex items-center pl-4 h-[28px] text-muted-foreground/60 text-[12px] italic">
              No files yet
            </div>
          )}
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
    </ExplorerCtx.Provider>
  );
}
