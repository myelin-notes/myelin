import {
  type Action,
  comboMatches,
  type KeybindingRegistry,
  type KeyCombo,
} from './registry';

export interface ActionBinding {
  action: Action;
  /** Opt in for app-level shortcuts that should still work while typing. */
  allowEditable?: boolean;
  onDown?: (e: KeyboardEvent) => void;
  onUp?: (e: KeyboardEvent) => void;
}

// Command palette items should only mirror bindings that behave like a single
// command invocation, not press/release pairs such as hold-to-pan.
function isCommandAction(binding: ActionBinding): binding is ActionBinding & {
  onDown: NonNullable<ActionBinding['onDown']>;
} {
  return !!binding.onDown && !binding.onUp;
}

/** Returns true if the event should be ignored (input fields, contenteditable). */
function isEditableTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    (e.target as HTMLElement)?.isContentEditable === true
  );
}

export class KeybindingHandler {
  private bindings: ActionBinding[] = [];
  private listening = false;
  private listeners = new Set<() => void>();

  constructor(
    private registry: KeybindingRegistry,
    private filter: (e: KeyboardEvent) => boolean = (e) => !isEditableTarget(e),
  ) {}

  register(bindings: ActionBinding[]): () => void {
    this.bindings.push(...bindings);
    if (!this.listening) {
      this.startListening();
    }
    this.emitChange();
    return () => {
      let changed = false;
      for (const b of bindings) {
        const i = this.bindings.indexOf(b);
        if (i >= 0) {
          this.bindings.splice(i, 1);
          changed = true;
        }
      }
      if (this.bindings.length === 0) {
        this.stopListening();
      }
      if (changed) {
        this.emitChange();
      }
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getCommandPaletteActions(): Action[] {
    const actions: Action[] = [];
    const seen = new Set<Action>();

    for (const binding of this.bindings) {
      if (!isCommandAction(binding) || seen.has(binding.action)) {
        continue;
      }
      seen.add(binding.action);
      actions.push(binding.action);
    }

    return actions;
  }

  runAction(action: Action) {
    const combo = this.registry.getCombo(action);
    const event = createSyntheticKeyboardEvent(combo);

    for (const binding of this.bindings) {
      if (binding.action === action && isCommandAction(binding)) {
        binding.onDown(event);
      }
    }
  }

  destroy() {
    this.stopListening();
    this.bindings = [];
    this.emitChange();
  }

  private startListening() {
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.listening = true;
  }

  private stopListening() {
    if (typeof window === 'undefined') {
      return;
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.listening = false;
  }

  private emitChange() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    for (const b of this.bindings) {
      if (!b.allowEditable && isEditableTarget(e)) {
        continue;
      }
      const combo = this.registry.getCombo(b.action);
      if (combo && comboMatches(e, combo)) {
        b.onDown?.(e);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    for (const b of this.bindings) {
      if (!b.allowEditable && !this.filter(e)) {
        continue;
      }
      const combo = this.registry.getCombo(b.action);
      if (combo && comboMatches(e, combo)) {
        b.onUp?.(e);
      }
    }
  };
}

function createSyntheticKeyboardEvent(
  combo: KeyCombo | undefined,
): KeyboardEvent {
  if (typeof KeyboardEvent !== 'undefined') {
    return new KeyboardEvent('keydown', {
      altKey: !!combo?.alt,
      bubbles: true,
      cancelable: true,
      ctrlKey: !!combo?.mod,
      key: combo?.key ?? '',
      metaKey: !!combo?.mod,
      shiftKey: !!combo?.shift,
    });
  }

  let defaultPrevented = false;
  return {
    altKey: !!combo?.alt,
    ctrlKey: !!combo?.mod,
    get defaultPrevented() {
      return defaultPrevented;
    },
    key: combo?.key ?? '',
    metaKey: !!combo?.mod,
    preventDefault() {
      defaultPrevented = true;
    },
    shiftKey: !!combo?.shift,
    stopPropagation() {},
  } as KeyboardEvent;
}
