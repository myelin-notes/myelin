export type { ActionBinding } from './handler';
export { KeybindingHandler } from './handler';
export {
  type Action,
  type ActionDef,
  type ActionMap,
  type ActionMeta,
  comboMatches,
  comboToPMKey,
  formatKeyCombo,
  KeybindingRegistry,
  type KeyCombo,
} from './registry';

import { KeybindingHandler } from './handler';
import { KeybindingRegistry } from './registry';

export const registry = new KeybindingRegistry();
export const keybindings = new KeybindingHandler(registry);

declare module './registry' {
  interface ActionMap {
    'canvas:pan': true;
    'canvas:undo': true;
    'canvas:redo': true;
    'canvas:delete': true;
    'canvas:tool-text': true;
    'editor:bold': true;
    'editor:italic': true;
    'editor:underline': true;
    'editor:strikethrough': true;
    'editor:code': true;
  }
}

registry.defineDefaults(
  {
    'canvas:undo': { key: 'z', mod: true },
    'canvas:redo': { key: 'z', mod: true, shift: true },
  },
  { locked: true },
);

registry.defineDefaults({
  'canvas:pan': {
    key: ' ',
  },
  'canvas:delete': {
    key: 'Backspace',
  },
  'canvas:tool-text': {
    key: 't',
  },
  'editor:bold': {
    key: 'b',
    mod: true,
  },
  'editor:italic': {
    key: 'i',
    mod: true,
  },
  'editor:underline': {
    key: 'u',
    mod: true,
  },
  'editor:strikethrough': {
    key: 's',
    mod: true,
    shift: true,
  },
  'editor:code': {
    key: 'e',
    mod: true,
  },
});
