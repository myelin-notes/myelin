import type { ComponentType } from 'react';
import {
  Bot,
  Brush,
  Cloud,
  HardDriveDownload,
  Info,
  Keyboard,
  Languages,
  PenLine,
  ShieldCheck,
} from 'lucide-react';
import { isMobile } from '@/lib/platform';

export type SettingsSectionId =
  | 'appearance'
  | 'language'
  | 'editing'
  | 'sync'
  | 'data'
  | 'privacy'
  | 'mcp'
  | 'keybinds'
  | 'about';

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  titleKey:
    | 'canvasStyle'
    | 'language'
    | 'pageFrameEditing'
    | 'repository'
    | 'dataExport'
    | 'privacy'
    | 'mcp'
    | 'keybinds'
    | 'about';
  icon: ComponentType<{ className?: string }>;
  /** Hidden on mobile — the feature is desktop-only (see {@link isMobile}). */
  desktopOnly?: boolean;
}

const ALL_SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'appearance', titleKey: 'canvasStyle', icon: Brush },
  { id: 'language', titleKey: 'language', icon: Languages },
  { id: 'editing', titleKey: 'pageFrameEditing', icon: PenLine },
  { id: 'sync', titleKey: 'repository', icon: Cloud },
  {
    id: 'data',
    titleKey: 'dataExport',
    icon: HardDriveDownload,
    desktopOnly: true,
  },
  { id: 'privacy', titleKey: 'privacy', icon: ShieldCheck },
  { id: 'mcp', titleKey: 'mcp', icon: Bot, desktopOnly: true },
  { id: 'keybinds', titleKey: 'keybinds', icon: Keyboard, desktopOnly: true },
  { id: 'about', titleKey: 'about', icon: Info },
] as const;

/**
 * Sections to show on the current platform. Desktop-only sections (MCP, data
 * export, keybindings) are dropped on mobile. Drives both the settings rail and
 * the rendered section list so they can't drift apart.
 */
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] =
  ALL_SETTINGS_SECTIONS.filter((section) => !(isMobile && section.desktopOnly));
