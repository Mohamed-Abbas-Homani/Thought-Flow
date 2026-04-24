import { useLayoutStore } from "../../store/layoutStore";
import { FileExplorerPanel } from "./FileExplorer";

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;

export function Sidebar() {
  const { sidebarWidth: width, setSidebarWidth: setWidth } = useLayoutStore();

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    function onMouseMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  return (
    <div style={{ width }} className="flex flex-col h-full shrink-0 relative bg-background border-r border-border">
      <FileExplorerPanel />
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-ring/40 transition-colors z-10"
      />
    </div>
  );
}
