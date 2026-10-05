import { describe, expect, it } from 'vitest';
import { InputModeController } from './input-mode';
import { UserPrefs } from './user-prefs';

describe('InputModeController', () => {
  it('drives every tool with a finger by default', () => {
    expect(new InputModeController().touchDrivesTool).toBe(true);
  });

  it('leaves drawing to the stylus in pen mode', () => {
    UserPrefs.set('inputMode', 'pen');
    expect(new InputModeController().touchDrivesTool).toBe(false);
  });

  it('rewrites the retired auto mode to touch', () => {
    localStorage.setItem('myelin:input-mode', JSON.stringify('auto'));
    expect(new InputModeController().mode).toBe('touch');
    expect(UserPrefs.get('inputMode')).toBe('touch');
  });

  it('follows the preference while alive', () => {
    UserPrefs.set('inputMode', 'touch');
    const input = new InputModeController();
    UserPrefs.set('inputMode', 'pen');
    expect(input.touchDrivesTool).toBe(false);
  });

  it('stops following the preference once destroyed', () => {
    UserPrefs.set('inputMode', 'touch');
    const input = new InputModeController();
    input.destroy();
    UserPrefs.set('inputMode', 'pen');

    expect(input.mode).toBe('touch');
  });
});
