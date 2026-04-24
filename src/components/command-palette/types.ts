import type { KeyboardEvent, RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';

export type CommandPaletteMode = 'commands' | 'notes';

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
  onSelect: () => void | Promise<void>;
}

export interface CommandPaletteDialogProps {
  activeIndex: number;
  footerShortcut: string;
  inputRef: RefObject<HTMLInputElement | null>;
  items: CommandPaletteItem[];
  loading: boolean;
  mode: CommandPaletteMode;
  open: boolean;
  query: string;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onQueryChange: (query: string) => void;
  onRunItem: (item: CommandPaletteItem) => void;
}
