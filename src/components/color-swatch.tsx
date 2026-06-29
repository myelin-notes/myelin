import type { PointerEvent } from 'react';

interface ColorSwatchProps {
  color: string;
  active?: boolean;
  title?: string;
  onClick: () => void;
  // The text toolbar needs preventDefault to preserve the ProseMirror
  // selection when interacting with the swatch; the pen picker doesn't.
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
}

export function ColorSwatch({
  color,
  active,
  title,
  onClick,
  onPointerDown,
}: ColorSwatchProps) {
  return (
    <button
      type="button"
      title={title}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className="size-5 cursor-pointer rounded-lg border-none p-0 transition-transform duration-150 hover:scale-110"
      style={{
        backgroundColor: color,
        boxShadow: active
          ? '0 0 0 2px var(--bg-card), 0 0 0 3.5px rgb(var(--shadow-rgb) / 0.25)'
          : 'inset 0 0 0 1px var(--border-ghost)',
        transform: active ? 'scale(1.15)' : undefined,
      }}
    />
  );
}
