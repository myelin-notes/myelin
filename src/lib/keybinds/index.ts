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
    label: 'Pan',
    description: 'Hold to drag the canvas',
  },
  'canvas:delete': {
    key: 'Backspace',
    label: 'Delete',
    description: 'Remove selected elements',
  },
  'canvas:tool-text': {
    key: 't',
    label: 'Text Tool',
    description: 'Create a new text node',
  },
  'editor:bold': {
    key: 'b',
    mod: true,
    label: 'Bold',
    description: 'Toggle bold formatting',
  },
  'editor:italic': {
    key: 'i',
    mod: true,
    label: 'Italic',
    description: 'Toggle italic formatting',
  },
  'editor:underline': {
    key: 'u',
    mod: true,
    label: 'Underline',
    description: 'Toggle underline formatting',
  },
  'editor:strikethrough': {
    key: 's',
    mod: true,
    shift: true,
    label: 'Strikethrough',
    description: 'Toggle strikethrough formatting',
  },
  'editor:code': {
    key: 'e',
    mod: true,
    label: 'Code',
    description: 'Toggle inline code formatting',
  },
});
