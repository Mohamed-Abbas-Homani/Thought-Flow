import { Sun, Moon, Check } from "lucide-react";
import { themes, type ColorMode } from "@/themes";
import { useSettingsStore } from "@/store/settingsStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ThemeModalProps {
  open: boolean;
  onClose: () => void;
}

const COLOR_MODES: { key: ColorMode; label: string; icon: React.ReactNode }[] = [
  { key: "light", label: "Light", icon: <Sun size={15} strokeWidth={1.5} /> },
  { key: "dark",  label: "Dark",  icon: <Moon size={15} strokeWidth={1.5} /> },
];

export function ThemeModal({ open, onClose }: ThemeModalProps) {
  const { theme, colorMode, setTheme, setColorMode } = useSettingsStore();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[480px]">
        <DialogHeader>
          <DialogTitle>Themes</DialogTitle>
        </DialogHeader>

        <DialogBody>
          {/* Color mode */}
          <section>
            <p className="text-muted-foreground text-xs uppercase tracking-widest mb-3">
              Color Mode
            </p>
            <div className="flex gap-2">
              {COLOR_MODES.map(({ key, label, icon }) => (
                <Button
                  key={key}
                  variant={colorMode === key ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setColorMode(key)}
                >
                  {icon}
                  {label}
                </Button>
              ))}
            </div>
          </section>

          {/* Theme picker */}
          <section>
            <p className="text-muted-foreground text-xs uppercase tracking-widest mb-3">
              Theme
            </p>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(themes).map(([key, t]) => {
                const tokens = t[colorMode];
                const isSelected = theme === key;
                return (
                  <button
                    key={key}
                    onClick={() => setTheme(key)}
                    className={[
                      "relative rounded-md border p-3 text-left transition-colors focus:outline-none",
                      isSelected ? "border-secondary" : "border-border hover:border-secondary/60",
                    ].join(" ")}
                  >
                    <div className="flex gap-1 mb-2">
                      {t.palette.map((color, i) => (
                        <span key={i} className="h-5 flex-1 rounded-sm" style={{ backgroundColor: color }} />
                      ))}
                    </div>
                    <div
                      className="rounded-sm p-2 mb-2 text-[10px] leading-none"
                      style={{ backgroundColor: tokens.background, color: tokens.foreground }}
                    >
                      <div className="flex gap-1 items-center">
                        <span className="w-4 h-2 rounded-sm inline-block" style={{ backgroundColor: tokens.primary }} />
                        <span style={{ color: tokens["muted-foreground"] }}>Aa</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-foreground text-xs">{t.name}</span>
                      {isSelected && <Check size={13} strokeWidth={2} className="text-secondary" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
