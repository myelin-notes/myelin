import type { ToolId } from './tools/tool';
import { UserPrefs } from './user-prefs';

/**
 * - `pen`: a stylus (or mouse) drives the tools, a finger pans and zooms.
 * - `touch`: a finger drives the tools too; panning is left to two fingers.
 * - `auto`: `pen` while a stylus looks connected, `touch` otherwise.
 */
export type InputMode = 'auto' | 'pen' | 'touch';

export type ResolvedInputMode = 'pen' | 'touch';

// Nothing in the platform reports a paired stylus — a pointer event is the only evidence — so
// `auto` infers presence from recent use, persisted so the first gesture after a launch behaves
// like the last one before it.
const STYLUS_PRESENT_MS = 14 * 24 * 60 * 60 * 1000;

/** A stylus emits hundreds of events a minute; only one of them needs storing. */
const STYLUS_WRITE_INTERVAL_MS = 60 * 60 * 1000;

export class InputModeController {
  private _mode: InputMode;
  private _stylusSeenAt: number;
  private readonly _unsubscribe: () => void;

  public constructor() {
    this._mode = UserPrefs.get('inputMode');
    this._stylusSeenAt = UserPrefs.get('stylusLastSeenAt');
    this._unsubscribe = UserPrefs.subscribe('inputMode', (mode) => {
      this._mode = mode;
    });
  }

  // Hover counts: a pen held over the glass has to flip the mode before it lands, or its first
  // stroke is preceded by a finger that still draws.
  public observe(event: PointerEvent): void {
    if (event.pointerType !== 'pen') {
      return;
    }
    const now = Date.now();
    if (now - this._stylusSeenAt > STYLUS_WRITE_INTERVAL_MS) {
      UserPrefs.set('stylusLastSeenAt', now);
    }
    this._stylusSeenAt = now;
  }

  public get mode(): InputMode {
    return this._mode;
  }

  public get resolved(): ResolvedInputMode {
    if (this._mode !== 'auto') {
      return this._mode;
    }
    return Date.now() - this._stylusSeenAt < STYLUS_PRESENT_MS
      ? 'pen'
      : 'touch';
  }

  // Select is excluded on purpose: it has no brush to hand a finger, and its touch gestures (tap,
  // drag a handle, drag a grabbable body) are already wired up, so one finger is worth more as a pan.
  public touchDrivesTool(toolId: ToolId): boolean {
    return this.resolved === 'touch' && toolId !== 'select';
  }

  public destroy(): void {
    this._unsubscribe();
  }
}
