import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditSessionController } from './edit-session-controller';
import type { DrawableElement } from './elements/drawable-element';

describe('EditSessionController', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enters and exits an edit session without document or pointer dependencies', () => {
    vi.stubGlobal('document', new EventTarget());
    const notifyChange = vi.fn();
    const onElementEdit = vi.fn();
    const exitEditMode = vi.fn();
    const element = {
      locksViewportPanWhileEditing: false,
      syncDOM: vi.fn(),
      enterEditMode: vi.fn(() => null),
      exitEditMode,
    } as unknown as DrawableElement;
    const controller = new EditSessionController({
      drawableCanvas: {} as never,
      canvas: { style: {} } as HTMLCanvasElement,
      viewport: { setEditMode: vi.fn() } as never,
      getElements: () => [element],
      getActiveToolId: () => 'select',
      clearSelection: () => {},
      beginToolInteraction: () => {},
      notifyChange,
    });
    controller.setOnElementEdit(onElementEdit);

    controller.enter(element);
    controller.exit();

    expect(element.enterEditMode).toHaveBeenCalled();
    expect(exitEditMode).toHaveBeenCalledOnce();
    expect(onElementEdit).toHaveBeenNthCalledWith(1, element);
    expect(onElementEdit).toHaveBeenNthCalledWith(2, null);
    expect(notifyChange).toHaveBeenCalledTimes(2);
  });
});
