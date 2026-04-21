export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export type CreatingType = "file" | "folder" | null;

export interface CtxMenuDef {
  x: number;
  y: number;
  entry: FsEntry;
  onRefresh: () => void;
  onStartRenaming: () => void;
  onStartCreating?: (type: CreatingType) => void;
}
