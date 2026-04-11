import { type Action, comboMatches, type KeybindingRegistry } from './registry';

export interface ActionBinding {
  action: Action;
  onDown?: (e: KeyboardEvent) => void;
  onUp?: (e: KeyboardEvent) => void;
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

  constructor(
    private registry: KeybindingRegistry,
    private filter: (e: KeyboardEvent) => boolean = (e) => !isEditableTarget(e),
  ) {}

  register(bindings: ActionBinding[]): () => void {
    this.bindings.push(...bindings);
    if (!this.listening) {
      this.startListening();
    }
    return () => {
      for (const b of bindings) {
        const i = this.bindings.indexOf(b);
        if (i >= 0) {
          this.bindings.splice(i, 1);
        }
      }
      if (this.bindings.length === 0) {
        this.stopListening();
      }
    };
  }

  destroy() {
    this.stopListening();
    this.bindings = [];
  }

  private startListening() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.listening = true;
  }

  private stopListening() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.listening = false;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.filter(e)) {
      return;
    }
    for (const b of this.bindings) {
      const combo = this.registry.getCombo(b.action);
      if (combo && comboMatches(e, combo)) {
        b.onDown?.(e);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!this.filter(e)) {
      return;
    }
    for (const b of this.bindings) {
      const combo = this.registry.getCombo(b.action);
      if (combo && comboMatches(e, combo)) {
        b.onUp?.(e);
      }
    }
  };
}
