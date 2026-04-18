import type { Messages } from '@/lib/i18n';
import type { Action } from './registry';

type ActionCopy =
  Messages['settings']['keybinds']['actions'][keyof Messages['settings']['keybinds']['actions']];

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
