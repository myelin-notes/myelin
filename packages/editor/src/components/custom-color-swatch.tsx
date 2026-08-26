import type { PointerEvent } from 'react';
import { Trash2, X as XIcon } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@myelin/ui/context-menu';
import { useMessages } from '../i18n';
import { ColorSwatch } from './color-swatch';

interface CustomColorSwatchProps {
  color: string;
  active?: boolean;
  onClick: () => void;
  onDelete: () => void;
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
  // The delete menu portals out of its container. Menus that dismiss on an
  // outside pointerdown use this to stay up while it's open.
  onMenuOpenChange?: (open: boolean) => void;
}

export function CustomColorSwatch({
  color,
  active,
  onClick,
  onDelete,
  onPointerDown,
  onMenuOpenChange,
}: CustomColorSwatchProps) {
  const strings = useMessages();
  const deleteLabel = strings.canvas.toolOptions.deleteColor;

  return (
    <ContextMenu onOpenChange={onMenuOpenChange}>
      <ContextMenuTrigger
        render={<span />}
        className="group relative inline-flex"
      >
        <ColorSwatch
          color={color}
          active={active}
          onClick={onClick}
          onPointerDown={onPointerDown}
          title={color}
        />
        {/* Pointer-only shortcut for the menu item below: Tailwind gates
            `group-hover` behind `@media (hover: hover)`, so touch never sees
            it — and at this size it would be well under a usable tap target. */}
        <button
          type="button"
          aria-label={`${deleteLabel} ${color}`}
          title={deleteLabel}
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
      </ContextMenuTrigger>
      <ContextMenuContent className="rounded-xl bg-page p-1.5 shadow-ambient">
        <ContextMenuItem
          className="gap-2.5 rounded-md px-3 py-2 text-destructive text-sm focus:bg-destructive/10 focus:text-destructive focus:*:[svg]:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
          {deleteLabel}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
