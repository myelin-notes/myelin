import { useEffect } from 'react';
import { type ActionBinding, keybindings } from '@/lib/keybindings';

export function useKeybindings(bindings: ActionBinding[]) {
  useEffect(() => keybindings.register(bindings), [bindings]);
}
