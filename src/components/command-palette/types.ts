import type { KeyboardEvent, RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';

export type CommandPaletteMode = 'commands' | 'notes';
export type CommandPalettePage =
  | 'canvas'
  | 'graph'
  | 'home'
  | 'settings'
  | 'unknown';

export interface CommandPaletteEntry {
  id: string;
  label: string;
  description: string;
  keywords?: string[];
}

export interface CommandPaletteItem extends CommandPaletteEntry {
  section: string;
  icon: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  visibleOn?: readonly CommandPalettePage[];
  onSelect: () => void | Promise<void>;
}

export interface CommandPaletteModeState {
  emptyMessage: string;
  items: CommandPaletteItem[];
  loading: boolean;
  placeholder: string;
}

export interface CommandPaletteDialogProps {
  activeIndex: number;
  footerShortcut: string;
  inputRef: RefObject<HTMLInputElement | null>;
  items: CommandPaletteItem[];
  emptyMessage: string;
  loading: boolean;
  open: boolean;
  placeholder: string;
  query: string;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onQueryChange: (query: string) => void;
  onRunItem: (item: CommandPaletteItem) => void;
}
