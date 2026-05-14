/**
 * Small singleton so imperative canvas elements (rendered via plain DOM)
 * can request a React-rendered menu popover without prop-drilling.
 *
 * The canvas page installs the opener on mount; elements' frame-chrome
 * hamburger buttons call {@link openChromeMenu} with the button's screen
 * rect and a list of items. Exactly one menu is visible at a time.
 */

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

let opener: ChromeMenuOpener = () => {};

export function setChromeMenuOpener(fn: ChromeMenuOpener): void {
  opener = fn;
}

export function openChromeMenu(anchor: DOMRect, items: ChromeMenuItem[]): void {
  if (items.length === 0) {
    return;
  }
  opener(anchor, items);
}
