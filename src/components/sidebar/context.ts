import { createContext } from "react";
import type { FsEntry, CtxMenuDef } from "./types";

export interface ExplorerCtxType {
  /** React state copy of activeDrag — used only for visual feedback (opacity). */
  dragging: FsEntry | null;
  setDragging: (e: FsEntry | null) => void;
  reloadVault: () => void;
  showMenu: (menu: CtxMenuDef) => void;
}

export const ExplorerCtx = createContext<ExplorerCtxType>({
  dragging: null,
  setDragging: () => {},
  reloadVault: () => {},
  showMenu: () => {},
});
