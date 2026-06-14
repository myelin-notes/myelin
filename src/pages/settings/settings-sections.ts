import type { ComponentType } from 'react';
import {
  Bot,
  Brush,
  Cloud,
  HardDriveDownload,
  Keyboard,
  Languages,
  PenLine,
} from 'lucide-react';

export type SettingsSectionId =
  | 'appearance'
  | 'language'
  | 'editing'
  | 'sync'
  | 'data'
  | 'mcp'
  | 'keybinds';

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  titleKey:
    | 'canvasStyle'
    | 'language'
    | 'pageFrameEditing'
    | 'repository'
    | 'dataExport'
    | 'mcp'
    | 'keybinds';
  icon: ComponentType<{ className?: string }>;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'appearance', titleKey: 'canvasStyle', icon: Brush },
  { id: 'language', titleKey: 'language', icon: Languages },
  { id: 'editing', titleKey: 'pageFrameEditing', icon: PenLine },
  { id: 'sync', titleKey: 'repository', icon: Cloud },
  { id: 'data', titleKey: 'dataExport', icon: HardDriveDownload },
  { id: 'mcp', titleKey: 'mcp', icon: Bot },
  { id: 'keybinds', titleKey: 'keybinds', icon: Keyboard },
] as const;
