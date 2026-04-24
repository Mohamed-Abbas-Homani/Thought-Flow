import { useEffect, useRef } from "react";
import { remove } from "@tauri-apps/plugin-fs";
import type { CtxMenuDef, CreatingType } from "./types";

interface Props {
  menu: CtxMenuDef;
  onClose: () => void;
}

export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const x = Math.min(menu.x, window.innerWidth - 210);
  const y = Math.min(menu.y, window.innerHeight - 180);

  async function handleDelete() {
    onClose();
    try {
      await remove(menu.entry.path, { recursive: true });
      menu.onRefresh();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  type Item =
    | { kind: "action"; label: string; danger?: boolean; action: () => void }
    | { kind: "sep" };

  const items: Item[] = [
    ...(menu.entry.isDirectory
      ? ([
          {
            kind: "action",
            label: "New File",
            action: () => { menu.onStartCreating?.("file" as CreatingType); onClose(); },
          },
          {
            kind: "action",
            label: "New Folder",
            action: () => { menu.onStartCreating?.("folder" as CreatingType); onClose(); },
          },
          { kind: "sep" },
        ] as Item[])
      : []),
    {
      kind: "action",
      label: "Rename",
      action: () => { menu.onStartRenaming(); onClose(); },
    },
    { kind: "action", label: "Delete", danger: true, action: handleDelete },
  ];

  return (
    <div
      ref={ref}
      style={{ top: y, left: x }}
      className="fixed z-[200] min-w-[180px] bg-primary border border-border shadow-xl py-1 rounded-sm"
    >
      {items.map((item, i) =>
        item.kind === "sep" ? (
          <div key={i} className="h-px bg-border my-1" />
        ) : (
          <button
            key={i}
            className={`flex w-full px-4 py-1.5 text-[13px] cursor-default transition-colors hover:bg-secondary ${
              item.danger
                ? "text-error"
                : "text-foreground/80 hover:text-foreground"
            }`}
            onClick={item.action}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
