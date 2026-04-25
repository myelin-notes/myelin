import type { LucideIcon } from 'lucide-react';
import {
  Bold,
  Code,
  Command,
  Eraser,
  Hand,
  Highlighter,
  ImagePlus,
  Italic,
  MousePointer2,
  PenTool,
  Redo2,
  ScanSearch,
  Square,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';
import type { Messages } from '@/lib/i18n';
import type { Action } from './registry';

type ActionCopy =
  Messages['settings']['keybinds']['actions'][keyof Messages['settings']['keybinds']['actions']];

const ACTION_ICONS: Partial<Record<Action, LucideIcon>> = {
  'app:command-palette': Command,
  'canvas:pan': Hand,
  'canvas:undo': Undo2,
  'canvas:redo': Redo2,
  'canvas:select-all': ScanSearch,
  'canvas:delete': Trash2,
  'canvas:tool-select': MousePointer2,
  'canvas:tool-pen': PenTool,
  'canvas:tool-highlighter': Highlighter,
  'canvas:tool-eraser': Eraser,
  'canvas:tool-text': Type,
  'canvas:insert-frame': Square,
  'canvas:insert-embed': ImagePlus,
  'editor:bold': Bold,
  'editor:italic': Italic,
  'editor:underline': Underline,
  'editor:strikethrough': Strikethrough,
  'editor:code': Code,
};

export function getActionCopy(
  messages: Messages,
  action: Action,
): ActionCopy | null {
  const actions = messages.settings.keybinds.actions as Record<
    string,
    ActionCopy
  >;
  return actions[action] ?? null;
}

export function getActionCategory(messages: Messages, action: Action): string {
  const [namespace] = action.split(':');
  const categories = messages.settings.keybinds.categories as Record<
    string,
    string
  >;
  return (
    categories[namespace] ??
    namespace.charAt(0).toUpperCase() + namespace.slice(1)
  );
}

export function getActionIcon(action: Action): LucideIcon | null {
  return ACTION_ICONS[action] ?? null;
}
