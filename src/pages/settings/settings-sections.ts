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
  Sparkles,
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
  | 'pro'
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
    | 'pro'
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
  { id: 'input', titleKey: 'input', icon: Pointer },
  { id: 'editing', titleKey: 'pageFrameEditing', icon: PenLine },
  { id: 'sync', titleKey: 'repository', icon: Cloud },
  {
    id: 'data',
    titleKey: 'dataExport',
    icon: HardDriveDownload,
  },
  { id: 'privacy', titleKey: 'privacy', icon: ShieldCheck },
  { id: 'mcp', titleKey: 'mcp', icon: Bot, desktopOnly: true },
  { id: 'keybinds', titleKey: 'keybinds', icon: Keyboard, desktopOnly: true },
  { id: 'pro', titleKey: 'pro', icon: Sparkles },
  { id: 'about', titleKey: 'about', icon: Info },
] as const;

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] =
  ALL_SETTINGS_SECTIONS.filter(
    (section) =>
      !(IS_MOBILE_BUILD && section.desktopOnly) &&
      !(!isTouchDevice && section.touchOnly),
  );
