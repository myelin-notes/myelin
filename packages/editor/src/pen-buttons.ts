import { UserPrefs } from './user-prefs';

export type PenButtonAction = 'eraser' | 'toolWheel' | 'pan';

/** The `PointerEvent.button` each action is bound to; `null` leaves it unbound. */
export type PenButtonBindings = Record<PenButtonAction, number | null>;

// PointerEvent.buttons bit for each PointerEvent.button index.
const BUTTON_BITS = [1, 4, 2, 8, 16, 32];

/** The `PointerEvent.buttons` bit for a `PointerEvent.button`, or 0 when there is none. */
export function buttonBit(button: number | null): number {
  return button === null ? 0 : (BUTTON_BITS[button] ?? 0);
}

export function penButtonBit(action: PenButtonAction): number {
  return buttonBit(UserPrefs.get('penButtons')[action]);
}

/** Binds `button` to `action`, unbinding it from whichever action held it before. */
export function bindPenButton(action: PenButtonAction, button: number): void {
  UserPrefs.update('penButtons', (current) => {
    const next = { ...current };
    for (const key of Object.keys(next) as PenButtonAction[]) {
      if (next[key] === button) {
        next[key] = null;
      }
    }
    next[action] = button;
    return next;
  });
}
