import type { PointerEvent } from 'react';
import { Plus as PlusIcon } from 'lucide-react';

interface AddColorSwatchProps {
  onClick: () => void;
  title?: string;
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
  size?: 'sm' | 'md';
}

export function AddColorSwatch({
  onClick,
  onPointerDown,
  title = 'Add custom color',
  size = 'sm',
}: AddColorSwatchProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={`${size === 'md' ? 'pointer-coarse:size-8 size-6' : 'size-5'} flex cursor-pointer items-center justify-center rounded-lg border-none bg-transparent p-0 text-text-muted transition-all duration-150 hover:scale-110 hover:text-text-primary`}
      style={{
        boxShadow: 'inset 0 0 0 1px var(--border-divider)',
      }}
    >
      <PlusIcon className="size-3" strokeWidth={2.5} />
    </button>
  );
}
