import { readDir } from "@tauri-apps/plugin-fs";
import type { FsEntry } from "./types";

export const BORDER = "border-[color-mix(in_srgb,var(--background)_82%,black_18%)]";

export async function listDir(path: string): Promise<FsEntry[]> {
  const entries = await readDir(path);
  return entries
    .filter((e) => e.name && !e.name.startsWith("."))
    .map((e) => ({
      name: e.name!,
      path: `${path}/${e.name}`,
      isDirectory: e.isDirectory,
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** Returns the parent directory of a path. */
export function dirOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}
