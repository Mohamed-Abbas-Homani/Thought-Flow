import { useEffect, useRef } from "react";

interface RenameInputProps {
  defaultValue: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

export function RenameInput({ defaultValue, onCommit, onCancel }: RenameInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const dot = defaultValue.lastIndexOf(".");
    ref.current?.setSelectionRange(0, dot > 0 ? dot : defaultValue.length);
  }, [defaultValue]);

  function handleKey(e: React.KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter") {
      const val = ref.current?.value.trim();
      if (val) onCommit(val);
      else onCancel();
    } else if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <input
      ref={ref}
      defaultValue={defaultValue}
      onKeyDown={handleKey}
      onBlur={onCancel}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 bg-background border border-ring text-foreground text-[14px] px-1 h-[20px] outline-none rounded-sm"
    />
  );
}

interface InlineInputProps {
  icon: React.ReactNode;
  indent: number;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

export function InlineInput({ icon, indent, onCommit, onCancel }: InlineInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      const val = ref.current?.value.trim();
      if (val) onCommit(val);
      else onCancel();
    } else if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div style={{ paddingLeft: indent }} className="flex items-center gap-1.5 h-[28px] pr-2">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <input
        ref={ref}
        onKeyDown={handleKey}
        onBlur={onCancel}
        className="flex-1 bg-background border border-ring text-foreground text-[14px] px-1 h-[20px] outline-none rounded-sm"
      />
    </div>
  );
}
