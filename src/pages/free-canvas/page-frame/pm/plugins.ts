import { history } from 'prosemirror-history';
import type { Plugin } from 'prosemirror-state';
import { buildInputRules } from './input-rules';
import { buildKeymap } from './keymap';
import { schema } from './schema';

export function buildPlugins(): Plugin[] {
  return [buildInputRules(schema), buildKeymap(schema), history()];
}
