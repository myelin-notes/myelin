import { Redo2, Undo2 } from 'lucide-react';
import type { ITool } from '@/pages/canvas/tools/tool';

interface ToolShelfProps {
  tools: ITool[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * The bottom tool shelf, mirroring the app's canvas toolbar: the same tools
 * (they ARE the app's tool objects), the same icons, and the active tool's
 * real color palette.
 */
export function ToolShelf({
  tools,
  activeIndex,
  onSelect,
  onUndo,
  onRedo,
}: ToolShelfProps) {
  const activeTool = tools[activeIndex];
  const colorOption = activeTool
    ?.getOptions?.()
    ?.find((option) => option.type === 'color');

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center">
      <div className="flex items-center gap-1 rounded-xl bg-card px-2 py-1.5 shadow-elevated ring-1 ring-border-subtle">
        {tools.map((tool, index) => {
          const Icon = tool.icon;
          const isActive = index === activeIndex;
          return (
            <button
              key={tool.id}
              type="button"
              title={tool.label}
              aria-label={tool.label}
              aria-pressed={isActive}
              onClick={() => onSelect(index)}
              className={`cursor-pointer rounded-lg p-2.5 transition-colors ${
                isActive
                  ? 'bg-accent-dark text-text-on-dark'
                  : 'bg-transparent text-text-secondary hover:bg-hover-tint'
              }`}
            >
              <Icon className="size-4" />
            </button>
          );
        })}

        {colorOption && colorOption.type === 'color' && (
          <>
            <div className="mx-1 h-5 w-px bg-border-divider" />
            {colorOption.palette.slice(0, 5).map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Ink color ${color}`}
                onClick={() => colorOption.set(color)}
                className={`size-5 cursor-pointer rounded-full transition-transform hover:scale-110 ${
                  colorOption.value === color
                    ? 'ring-2 ring-accent-dark ring-offset-2 ring-offset-card'
                    : 'ring-1 ring-border-divider'
                }`}
                style={{ background: color }}
              />
            ))}
          </>
        )}

        <div className="mx-1 h-5 w-px bg-border-divider" />
        <button
          type="button"
          title="Undo"
          aria-label="Undo"
          onClick={onUndo}
          className="cursor-pointer rounded-lg p-2.5 text-text-secondary transition-colors hover:bg-hover-tint"
        >
          <Undo2 className="size-4" />
        </button>
        <button
          type="button"
          title="Redo"
          aria-label="Redo"
          onClick={onRedo}
          className="cursor-pointer rounded-lg p-2.5 text-text-secondary transition-colors hover:bg-hover-tint"
        >
          <Redo2 className="size-4" />
        </button>
      </div>
    </div>
  );
}
