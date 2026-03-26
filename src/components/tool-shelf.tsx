import { useEffect } from "react";
import type { ITool } from "@/pages/free-canvas/tools/tool";

const STORAGE_KEY = "myelin:wheel-tools";

interface ToolShelfProps {
  tools: ITool[];
  enabledIndices: Set<number>;
  onToggle: (index: number) => void;
  onClose: () => void;
  containerRef?: React.RefObject<HTMLElement | null>;
}

export function ToolShelf({ tools, enabledIndices, onToggle, onClose, containerRef }: ToolShelfProps) {
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (containerRef?.current?.contains(target)) return;
      onClose();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose, containerRef]);

  return (
    <div className="w-56 backdrop-blur-[24px] bg-white/85 rounded-xl shadow-ambient overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-primary">
          Tool Shelf
        </span>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary transition-colors cursor-pointer bg-transparent border-none p-0"
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="px-2 pb-2 flex flex-col gap-0.5">
        {tools.map((tool, index) => {
          const Icon = tool.icon;
          const enabled = enabledIndices.has(index);
          return (
            <button
              key={index}
              onClick={() => onToggle(index)}
              className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors cursor-pointer border-none w-full ${
                enabled
                  ? "bg-secondary-container/30 hover:bg-secondary-container/50"
                  : "bg-transparent hover:bg-hover-tint"
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`size-4 ${enabled ? "text-accent-dark" : "text-text-muted"}`} />
                <span className="text-xs font-medium text-text-primary">{tool.label}</span>
              </div>
              <div className={`w-7 h-3.5 rounded-full relative flex items-center px-0.5 transition-colors ${
                enabled ? "bg-accent-dark" : "bg-text-muted/20"
              }`}>
                <div className={`h-2.5 w-2.5 bg-white rounded-full transition-transform ${
                  enabled ? "translate-x-3" : "translate-x-0"
                }`} />
              </div>
            </button>
          );
        })}
      </div>
      {enabledIndices.size === 0 && (
        <p className="px-4 pb-3 text-[11px] text-text-muted">
          Wheel disabled — right-click won't open it.
        </p>
      )}
    </div>
  );
}

export function loadWheelToolIndices(toolCount: number): Set<number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: number[] = JSON.parse(stored);
      const valid = parsed.filter((i) => i >= 0 && i < toolCount);
      if (valid.length > 0) return new Set(valid);
    }
  } catch {}
  // Default: all tools enabled
  return new Set(Array.from({ length: toolCount }, (_, i) => i));
}

export function saveWheelToolIndices(indices: Set<number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...indices]));
}
