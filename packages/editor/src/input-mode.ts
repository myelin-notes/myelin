import { UserPrefs } from './user-prefs';

/**
 * - `pen`: a stylus (or mouse) drives the tools, a finger pans and zooms.
 * - `touch`: a finger drives the tools too; panning is left to two fingers.
 */
export type InputMode = 'pen' | 'touch';

export class InputModeController {
  private _mode: InputMode;
  private readonly _unsubscribe: () => void;

  public constructor() {
    // 0.2.x stored an `auto` mode; it defaulted to touch.
    if ((UserPrefs.get('inputMode') as string) === 'auto') {
      UserPrefs.set('inputMode', 'touch');
    }
    this._mode = UserPrefs.get('inputMode');
    this._unsubscribe = UserPrefs.subscribe('inputMode', (mode) => {
      this._mode = mode;
    });
  }

  public get mode(): InputMode {
    return this._mode;
  }

  // Select included: a finger that pans instead can never draw a marquee or a lasso, and touch mode
  // has two fingers for panning.
  public get touchDrivesTool(): boolean {
    return this._mode === 'touch';
  }

  public destroy(): void {
    this._unsubscribe();
  }
}
