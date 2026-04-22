import type { PointerEvent } from 'react';
import { X as XIcon } from 'lucide-react';
import { ColorSwatch } from './color-swatch';

interface CustomColorSwatchProps {
  color: string;
  active?: boolean;
  onClick: () => void;
  onDelete: () => void;
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
}

export function CustomColorSwatch({
  color,
  active,
  onClick,
  onDelete,
  onPointerDown,
}: CustomColorSwatchProps) {
  return (
    <span className="group relative inline-flex">
      <ColorSwatch
        color={color}
        active={active}
        onClick={onClick}
        onPointerDown={onPointerDown}
        title={color}
      />
      <button
        type="button"
        aria-label={`Delete ${color}`}
        title="Delete color"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="pointer-events-none absolute -top-1 -right-1 flex size-3.5 cursor-pointer items-center justify-center rounded-full border-none bg-card p-0 text-text-secondary opacity-0 shadow-ambient transition-opacity duration-100 hover:text-text-primary focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        style={{ boxShadow: 'inset 0 0 0 0.5px var(--border-ghost)' }}
      >
        <XIcon className="size-2.5" strokeWidth={2.5} />
      </button>
    </span>
  );
}
