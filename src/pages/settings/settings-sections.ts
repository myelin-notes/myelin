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
  Pointer,
  ShieldCheck,
} from 'lucide-react';
import { isTouchDevice } from '@myelin/shared/os';
import { IS_MOBILE_BUILD } from '@/lib/env';

export type SettingsSectionId =
  | 'appearance'
  | 'language'
  | 'input'
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
    | 'input'
    | 'pageFrameEditing'
    | 'repository'
    | 'dataExport'
    | 'privacy'
    | 'mcp'
    | 'keybinds'
    | 'about';
  icon: ComponentType<{ className?: string }>;
  /** Hidden on mobile — the feature is desktop-only (see {@link IS_MOBILE_BUILD}). */
  desktopOnly?: boolean;
  /** Hidden without a touch screen — there is nothing to choose there. */
  touchOnly?: boolean;
}

const ALL_SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'appearance', titleKey: 'canvasStyle', icon: Brush },
  { id: 'language', titleKey: 'language', icon: Languages },
  { id: 'input', titleKey: 'input', icon: Pointer, touchOnly: true },
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
 * Desktop-only sections (MCP, data export, keybindings) are dropped on mobile, and touch-only ones
 * (input mode) on a machine with no touch screen. Drives both the settings rail and the rendered
 * section list so they can't drift apart.
 */
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] =
  ALL_SETTINGS_SECTIONS.filter(
    (section) =>
      !(IS_MOBILE_BUILD && section.desktopOnly) &&
      !(!isTouchDevice && section.touchOnly),
  );
