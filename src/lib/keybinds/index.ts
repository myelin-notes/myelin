export type { ActionBinding } from './handler';
export { KeybindingHandler } from './handler';
export {
  type Action,
  type ActionMap,
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
    'app:command-palette': true;
    'tab:close': true;
    'canvas:pan': true;
    'canvas:undo': true;
    'canvas:redo': true;
    'canvas:select-all': true;
    'canvas:delete': true;
    'canvas:tool-select': true;
    'canvas:tool-pen': true;
    'canvas:tool-highlighter': true;
    'canvas:tool-eraser': true;
    'canvas:tool-text': true;
    'canvas:insert-frame': true;
    'canvas:insert-embed': true;
    'editor:bold': true;
    'editor:italic': true;
    'editor:underline': true;
    'editor:strikethrough': true;
    'editor:code': true;
  }
}

registry.defineDefaults({
  'app:command-palette': {
    key: 'p',
    mod: true,
  },
});

registry.defineDefaults(
  {
    'tab:close': { key: 'w', mod: true },
  },
  { locked: true },
);

registry.defineDefaults(
  {
    'canvas:undo': { key: 'z', mod: true },
    'canvas:redo': { key: 'z', mod: true, shift: true },
    'canvas:select-all': { key: 'a', mod: true },
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
  'canvas:tool-select': {
    key: 'v',
  },
  'canvas:tool-pen': {
    key: 'p',
  },
  'canvas:tool-highlighter': {
    key: 'h',
  },
  'canvas:tool-eraser': {
    key: 'e',
  },
  'canvas:tool-text': {
    key: 't',
  },
  'canvas:insert-frame': {
    key: 'f',
  },
  'canvas:insert-embed': {
    key: 'm',
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
