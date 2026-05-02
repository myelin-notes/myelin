import type { ComponentType } from 'react';
import { Brush, Cloud, Keyboard, Languages, PenLine } from 'lucide-react';

export type SettingsSectionId =
  | 'appearance'
  | 'language'
  | 'editing'
  | 'sync'
  | 'keybinds';

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  titleKey:
    | 'canvasStyle'
    | 'language'
    | 'pageFrameEditing'
    | 'repository'
    | 'keybinds';
  icon: ComponentType<{ className?: string }>;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'appearance', titleKey: 'canvasStyle', icon: Brush },
  { id: 'language', titleKey: 'language', icon: Languages },
  { id: 'editing', titleKey: 'pageFrameEditing', icon: PenLine },
  { id: 'sync', titleKey: 'repository', icon: Cloud },
  { id: 'keybinds', titleKey: 'keybinds', icon: Keyboard },
] as const;
