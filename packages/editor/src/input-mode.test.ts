import { beforeEach, describe, expect, it } from 'vitest';
import { InputModeController } from './input-mode';
import { UserPrefs } from './user-prefs';

const pointer = (pointerType: string): PointerEvent =>
  ({ pointerType }) as PointerEvent;

const DAY_MS = 24 * 60 * 60 * 1000;

describe('InputModeController', () => {
  let input: InputModeController;

  beforeEach(() => {
    input = new InputModeController();
  });

  it('starts on touch when no stylus has ever been seen', () => {
    expect(input.resolved).toBe('touch');
    expect(input.touchDrivesTool('pen')).toBe(true);
  });

  it('switches auto to pen as soon as a stylus is seen', () => {
    input.observe(pointer('touch'));
    expect(input.resolved).toBe('touch');

    input.observe(pointer('pen'));

    expect(input.resolved).toBe('pen');
    expect(input.touchDrivesTool('pen')).toBe(false);
  });

  it('remembers a stylus across sessions, and forgets a long-gone one', () => {
    UserPrefs.set('stylusLastSeenAt', Date.now() - DAY_MS);
    expect(new InputModeController().resolved).toBe('pen');

    UserPrefs.set('stylusLastSeenAt', Date.now() - 30 * DAY_MS);
    expect(new InputModeController().resolved).toBe('touch');
  });

  it('leaves the finger to panning with the select tool', () => {
    UserPrefs.set('inputMode', 'touch');
    input = new InputModeController();

    expect(input.touchDrivesTool('select')).toBe(false);
    expect(input.touchDrivesTool('highlighter')).toBe(true);
    expect(input.touchDrivesTool('eraser')).toBe(true);
  });

  it('honours an explicit mode over what the hardware says', () => {
    UserPrefs.set('inputMode', 'pen');
    input = new InputModeController();
    expect(input.touchDrivesTool('pen')).toBe(false);

    UserPrefs.set('inputMode', 'touch');
    input.observe(pointer('pen'));
    expect(input.touchDrivesTool('pen')).toBe(true);
  });

  it('stops following the preference once destroyed', () => {
    input.destroy();
    UserPrefs.set('inputMode', 'pen');

    expect(input.mode).toBe('auto');
  });
});
