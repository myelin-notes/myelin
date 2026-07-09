import type { PointerEvent } from 'react';
import { Plus as PlusIcon } from 'lucide-react';

interface AddColorSwatchProps {
  onClick: () => void;
  title?: string;
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
}

export function AddColorSwatch({
  onClick,
  onPointerDown,
  title = 'Add custom color',
}: AddColorSwatchProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className="flex size-5 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent p-0 text-text-muted transition-all duration-150 hover:scale-110 hover:text-text-primary"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--border-divider)',
      }}
    >
      <PlusIcon className="size-3" strokeWidth={2.5} />
    </button>
  );
}
