import type { LucideIcon } from 'lucide-react';

export interface ChromeMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  checked?: boolean;
  onSelect: () => void;
  variant?: 'default' | 'danger';
}

export type ChromeMenuOpener = (
  anchor: DOMRect,
  items: ChromeMenuItem[],
) => void;
