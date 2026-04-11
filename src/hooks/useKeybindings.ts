import { useEffect } from 'react';
import { type ActionBinding, keybindings } from '@/lib/keybinds';

export function useKeybindings(bindings: ActionBinding[]) {
  useEffect(() => keybindings.register(bindings), [bindings]);
}
