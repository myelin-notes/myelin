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
