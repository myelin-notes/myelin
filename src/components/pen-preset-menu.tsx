import { CircleDot, CircleOff, RefreshCw, Trash2 } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import type { PenPreset } from '@myelin/editor/sync/repo/types';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@myelin/ui/context-menu';

interface PenPresetMenuProps {
  preset: PenPreset;
  /** False when the live tool is not this preset's tool, so there is nothing to copy from. */
  canUpdateToCurrent: boolean;
  onUpdateToCurrent: () => void;
  onToggleInWheel: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}

/** Right-click (or long-press) menu shared by a preset's rail button and its shelf row. */
export function PenPresetMenu({
  preset,
  canUpdateToCurrent,
  onUpdateToCurrent,
  onToggleInWheel,
  onDelete,
  children,
}: PenPresetMenuProps) {
  const strings = useMessages().canvas.toolPresets;

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<span />} className="contents">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="rounded-xl bg-page p-1.5 shadow-ambient">
        {canUpdateToCurrent && (
          <ContextMenuItem
            className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
            onClick={onUpdateToCurrent}
          >
            <RefreshCw className="size-4" />
            {strings.updateToCurrent}
          </ContextMenuItem>
        )}
        <ContextMenuItem
          className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
          onClick={onToggleInWheel}
        >
          {preset.inWheel ? (
            <CircleOff className="size-4" />
          ) : (
            <CircleDot className="size-4" />
          )}
          {preset.inWheel ? strings.removeFromWheel : strings.showInWheel}
        </ContextMenuItem>
        <ContextMenuItem
          className="gap-2.5 rounded-md px-3 py-2 text-destructive text-sm focus:bg-destructive/10 focus:text-destructive focus:*:[svg]:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
          {strings.delete}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
