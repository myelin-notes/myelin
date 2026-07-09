import { describe, expect, it, vi } from 'vitest';
import { KeybindingHandler } from './handler';
import { KeybindingRegistry } from './registry';

function createHandler() {
  const registry = new KeybindingRegistry();
  registry.defineDefaults({
    'canvas:pan': { key: ' ' },
    'canvas:undo': { key: 'z', mod: true },
  });

  return new KeybindingHandler(registry);
}

describe('KeybindingHandler', () => {
  it('exposes only one-shot actions for command palette items', () => {
    const handler = createHandler();

    const dispose = handler.register([
      {
        action: 'canvas:undo',
        onDown: vi.fn(),
      },
      {
        action: 'canvas:undo',
        onDown: vi.fn(),
      },
      {
        action: 'canvas:pan',
        onDown: vi.fn(),
        onUp: vi.fn(),
      },
    ]);

    expect(handler.getCommandPaletteActions()).toEqual(['canvas:undo']);

    dispose();
  });

  it('runs registered one-shot actions programmatically', () => {
    const handler = createHandler();
    const onDown = vi.fn((event: KeyboardEvent) => event.preventDefault());

    handler.register([
      {
        action: 'canvas:undo',
        onDown,
      },
    ]);

    handler.runAction('canvas:undo');

    expect(onDown).toHaveBeenCalledTimes(1);
    expect(onDown.mock.calls[0][0]).toMatchObject({
      ctrlKey: true,
      key: 'z',
      metaKey: true,
    });
  });

  it('notifies subscribers when bindings change', () => {
    const handler = createHandler();
    const onChange = vi.fn();

    const unsubscribe = handler.subscribe(onChange);
    const dispose = handler.register([
      {
        action: 'canvas:undo',
        onDown: vi.fn(),
      },
    ]);

    expect(onChange).toHaveBeenCalledTimes(1);

    dispose();

    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});
