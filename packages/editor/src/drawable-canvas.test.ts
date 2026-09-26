import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasInteractionController } from './canvas-interaction-controller';
import {
  canMoveElementOrderForSelection,
  coalescedPointerSamples,
  type ElementOrderItem,
  isStylusTouch,
  moveElementOrderForSelection,
} from './drawable-canvas';
import { ElementType } from './elements/element-type';
import type { ITool } from './tools/tool';
import { UserPrefs } from './user-prefs';

const order = (...items: Array<[string, ElementType]>): ElementOrderItem[] =>
  items.map(([uuid, type]) => ({ uuid, type }));

describe('coalescedPointerSamples', () => {
  const event = (
    timeStamp: number,
    getCoalescedEvents?: () => PointerEvent[],
  ): PointerEvent =>
    ({ timeStamp, getCoalescedEvents }) as unknown as PointerEvent;

  it('returns every batched sample so a long frame keeps the whole stroke', () => {
    const batch = [event(110), event(120), event(130)];
    const delivered = event(130, () => batch);

    expect(coalescedPointerSamples(delivered, 100)).toEqual(batch);
  });

  it('uses only the delivered event while frames arrive on time', () => {
    const batch = [event(104), event(108)];
    const delivered = event(108, () => batch);

    expect(coalescedPointerSamples(delivered, 100)).toEqual([delivered]);
  });

  it('falls back to the delivered event when coalescing is unsupported', () => {
    const delivered = event(130);

    expect(coalescedPointerSamples(delivered, 100)).toEqual([delivered]);
  });

  it('falls back to the delivered event when the batch is empty', () => {
    const delivered = event(130, () => []);

    expect(coalescedPointerSamples(delivered, 100)).toEqual([delivered]);
  });
});

describe('isStylusTouch', () => {
  const touchEvent = (touches: { touchType?: string }[]) =>
    ({ changedTouches: touches }) as unknown as TouchEvent;

  it('spots a WebKit stylus touch', () => {
    expect(isStylusTouch(touchEvent([{ touchType: 'stylus' }]))).toBe(true);
    expect(
      isStylusTouch(
        touchEvent([{ touchType: 'direct' }, { touchType: 'stylus' }]),
      ),
    ).toBe(true);
  });

  it('is inert for fingers and for browsers without touchType', () => {
    expect(isStylusTouch(touchEvent([{ touchType: 'direct' }]))).toBe(false);
    expect(isStylusTouch(touchEvent([{}]))).toBe(false);
  });
});

describe('touch editing', () => {
  type TouchInteraction = {
    onPointerDown(event: PointerEvent): void;
    onPointerUp(event: PointerEvent): void;
    destroy(): void;
  };

  it('recognizes a double-tap within the screen-space tap tolerance', () => {
    UserPrefs.set('inputMode', 'pen');
    vi.stubGlobal('window', new EventTarget());
    const canvas = Object.assign(new EventTarget(), {
      style: {},
    }) as unknown as HTMLCanvasElement;
    const enterEditAtPoint = vi.fn(() => true);
    const tool = {
      id: 'select',
      start: () => {},
      update: () => {},
      finish: () => {},
      interrupt: () => {},
    } as unknown as ITool;
    let point = { x: 0, y: 0 };
    const interaction = new CanvasInteractionController({
      drawableCanvas: {
        shouldUseSelectToolForTouch: () => false,
      } as never,
      canvas,
      viewport: {
        getPoint: () => point,
        zoom: 0.5,
        panBy: () => {},
        beginPanGesture: () => {},
        panGestureBy: () => {},
        endPanGesture: () => {},
      } as never,
      getActiveTool: () => tool,
      setActiveTool: () => {},
      getTools: () => [tool],
      clearSelection: () => {},
      stopUndoCapturing: () => {},
      isPlacementActive: () => false,
      placeAt: () => {},
      endPlacement: () => {},
      enterEditAtPoint,
      refreshRendererSize: () => {},
    }) as unknown as TouchInteraction;
    const down = (clientX: number) =>
      ({
        clientX,
        clientY: 0,
        pointerId: 1,
        pointerType: 'touch',
      }) as PointerEvent;
    const up = (clientX: number) =>
      ({
        ...down(clientX),
        type: 'pointerup',
      }) as PointerEvent;
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(1100);

    interaction.onPointerDown(down(0));
    interaction.onPointerUp(up(0));
    point = { x: 12, y: 0 };
    interaction.onPointerDown(down(6));

    expect(enterEditAtPoint).toHaveBeenCalledWith(point, expect.anything());

    interaction.destroy();
    vi.unstubAllGlobals();
    UserPrefs.set('inputMode', 'touch');
  });
});

describe('tablet selection routing', () => {
  type TestableInteraction = {
    onPointerDown(event: PointerEvent): void;
    onPointerMove(event: PointerEvent): void;
    onPointerUp(event: PointerEvent): void;
    destroy(): void;
  };

  function makeInteraction(selectionClaimsTouch: boolean) {
    vi.stubGlobal('window', new EventTarget());
    const canvas = Object.assign(new EventTarget(), {
      style: {},
    }) as unknown as HTMLCanvasElement;
    const tool = {
      id: 'select',
      start: vi.fn(),
      update: vi.fn(),
      finish: vi.fn(),
      interrupt: vi.fn(),
    } as unknown as ITool;
    const viewport = {
      getPoint: () => ({ x: 10, y: 10 }),
      getScreenPoint: () => ({ x: 10, y: 10 }),
      offset: { x: 0, y: 0 },
      zoom: 1,
      panBy: vi.fn(),
      beginPanGesture: vi.fn(),
      panGestureBy: vi.fn(),
      endPanGesture: vi.fn(),
      setView: vi.fn(),
    };
    const interaction = new CanvasInteractionController({
      drawableCanvas: {
        shouldUseSelectToolForTouch: () => selectionClaimsTouch,
      } as never,
      canvas,
      viewport: viewport as never,
      getActiveTool: () => tool,
      setActiveTool: () => {},
      getTools: () => [tool],
      clearSelection: () => {},
      stopUndoCapturing: () => {},
      isPlacementActive: () => false,
      placeAt: () => {},
      endPlacement: () => {},
      enterEditAtPoint: () => false,
      refreshRendererSize: () => {},
    }) as unknown as TestableInteraction;
    return { interaction, tool, viewport };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    UserPrefs.set('inputMode', 'touch');
  });

  it.each([
    'pen',
    'touch',
  ] as const)('lets a finger manipulate a selected target in %s input mode', (inputMode) => {
    UserPrefs.set('inputMode', inputMode);
    const { interaction, tool } = makeInteraction(true);
    const event = {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 10,
      clientY: 10,
      type: 'pointerdown',
    } as PointerEvent;

    interaction.onPointerDown(event);
    interaction.onPointerUp({ ...event, type: 'pointerup' } as PointerEvent);

    expect(tool.start).toHaveBeenCalledWith(expect.anything(), event);
    expect(tool.finish).toHaveBeenCalled();
    interaction.destroy();
  });

  it.each([
    'pen',
    'touch',
  ] as const)('lets a stylus manipulate a selection in %s input mode', (inputMode) => {
    UserPrefs.set('inputMode', inputMode);
    const { interaction, tool } = makeInteraction(false);
    const event = {
      pointerId: 1,
      pointerType: 'pen',
      buttons: 1,
      clientX: 10,
      clientY: 10,
      type: 'pointerdown',
    } as PointerEvent;

    interaction.onPointerDown(event);
    interaction.onPointerUp({ ...event, type: 'pointerup' } as PointerEvent);

    expect(tool.start).toHaveBeenCalledWith(expect.anything(), event);
    expect(tool.finish).toHaveBeenCalled();
    interaction.destroy();
  });

  it('keeps another touch from moving or ending a pen stroke', () => {
    const { interaction, tool } = makeInteraction(false);
    const pen = {
      pointerId: 1,
      pointerType: 'pen',
      buttons: 1,
      timeStamp: 1,
      type: 'pointerdown',
    } as PointerEvent;
    const touch = {
      pointerId: 2,
      pointerType: 'touch',
      timeStamp: 2,
      type: 'pointermove',
    } as PointerEvent;

    interaction.onPointerDown(pen);
    vi.mocked(tool.update).mockClear();
    interaction.onPointerMove(touch);
    expect(tool.update).not.toHaveBeenCalled();
    interaction.onPointerUp({ ...touch, type: 'pointerup' } as PointerEvent);
    interaction.onPointerMove({
      ...pen,
      timeStamp: 3,
      type: 'pointermove',
    } as PointerEvent);

    expect(tool.update).toHaveBeenCalledTimes(1);
    expect(tool.finish).not.toHaveBeenCalled();
    interaction.onPointerUp({ ...pen, type: 'pointerup' } as PointerEvent);
    expect(tool.finish).toHaveBeenCalledTimes(1);
    interaction.destroy();
  });

  it('ignores touch while the pen hovers and resumes after it leaves', () => {
    vi.useFakeTimers();
    UserPrefs.set('inputMode', 'pen');
    const { interaction, viewport, tool } = makeInteraction(false);
    window.dispatchEvent(
      Object.assign(new Event('pointerover'), {
        pointerType: 'pen',
        buttons: 0,
      }),
    );
    const touch = {
      pointerId: 2,
      pointerType: 'touch',
    } as PointerEvent;
    interaction.onPointerDown(touch);

    expect(viewport.beginPanGesture).not.toHaveBeenCalled();
    expect(tool.start).not.toHaveBeenCalled();
    interaction.onPointerUp({ ...touch, type: 'pointerup' } as PointerEvent);
    window.dispatchEvent(
      Object.assign(new Event('pointerout'), {
        pointerType: 'pen',
        relatedTarget: null,
      }),
    );
    vi.advanceTimersByTime(200);
    interaction.onPointerDown({
      ...touch,
      pointerId: 3,
    } as PointerEvent);
    expect(viewport.beginPanGesture).toHaveBeenCalledTimes(1);
    interaction.destroy();
  });

  it('rolls back a touch pan when the pen begins hovering', () => {
    UserPrefs.set('inputMode', 'pen');
    const { interaction, viewport } = makeInteraction(false);
    const touch = {
      pointerId: 2,
      pointerType: 'touch',
      movementX: 0,
      movementY: 0,
      timeStamp: 1,
    } as PointerEvent;

    interaction.onPointerDown(touch);
    window.dispatchEvent(
      Object.assign(new Event('pointerover'), {
        pointerType: 'pen',
        buttons: 1,
      }),
    );
    expect(viewport.setView).not.toHaveBeenCalled();
    window.dispatchEvent(
      Object.assign(new Event('pointermove'), {
        pointerType: 'pen',
        buttons: 0,
      }),
    );

    expect(viewport.setView).toHaveBeenCalledWith({
      zoom: 1,
      offset: { x: 0, y: 0 },
    });
    expect(viewport.endPanGesture).not.toHaveBeenCalled();
    interaction.destroy();
  });

  it('rolls back a touch pan when Android cancels it as a palm', () => {
    UserPrefs.set('inputMode', 'pen');
    const { interaction, viewport } = makeInteraction(false);
    const touch = {
      pointerId: 2,
      pointerType: 'touch',
      width: 20,
      height: 20,
      movementX: 0,
      movementY: 0,
      timeStamp: 1,
    } as PointerEvent;

    interaction.onPointerDown(touch);
    interaction.onPointerUp({
      ...touch,
      type: 'pointercancel',
    } as PointerEvent);

    expect(viewport.setView).toHaveBeenCalledWith({
      zoom: 1,
      offset: { x: 0, y: 0 },
    });
    expect(viewport.endPanGesture).not.toHaveBeenCalled();
    interaction.destroy();
  });
});

describe('pen eraser override', () => {
  type TestableInteraction = {
    readonly selectedTool: ITool;
    eraserButtonsHeld: boolean;
    eraserOverrideApplied: boolean;
    penContactOpen: boolean;
    syncEraserOverride(event: PointerEvent): void;
    destroy(): void;
  };

  const interactions: TestableInteraction[] = [];

  const penEvent = (type: string, button: number, buttons: number) =>
    ({ type, button, buttons, pointerType: 'pen' }) as PointerEvent;

  function makeCanvas() {
    const pen = { id: 'pen' } as ITool;
    const eraser = { id: 'eraser' } as ITool;
    let selectedTool = pen;
    vi.stubGlobal('window', new EventTarget());
    const canvas = Object.assign(new EventTarget(), {
      style: {},
    }) as unknown as HTMLCanvasElement;
    const interaction = new CanvasInteractionController({
      drawableCanvas: {} as never,
      canvas,
      viewport: {} as never,
      getActiveTool: () => selectedTool,
      setActiveTool: (tool) => {
        selectedTool = tool;
      },
      getTools: () => [pen, eraser],
      clearSelection: () => {},
      stopUndoCapturing: () => {},
      isPlacementActive: () => false,
      placeAt: () => {},
      endPlacement: () => {},
      enterEditAtPoint: () => false,
      refreshRendererSize: () => {},
    }) as unknown as TestableInteraction;
    interactions.push(interaction);
    const controller = interaction as TestableInteraction;
    return { canvas: controller, pen, eraser };
  }

  afterEach(() => {
    for (const interaction of interactions.splice(0)) {
      interaction.destroy();
    }
    vi.unstubAllGlobals();
    UserPrefs.set('penBarrelButtonImmediate', false);
  });

  it('defaults to queued mode', () => {
    expect(UserPrefs.get('penBarrelButtonImmediate')).toBe(false);
  });

  it('applies button changes during contact in immediate mode', () => {
    UserPrefs.set('penBarrelButtonImmediate', true);
    const { canvas, pen, eraser } = makeCanvas();
    canvas.penContactOpen = true;

    canvas.syncEraserOverride(penEvent('pointermove', 2, 3));
    expect(canvas.eraserButtonsHeld).toBe(true);
    expect(canvas.eraserOverrideApplied).toBe(true);
    expect(canvas.selectedTool).toBe(eraser);

    canvas.syncEraserOverride(penEvent('pointermove', 2, 1));
    expect(canvas.eraserButtonsHeld).toBe(false);
    expect(canvas.eraserOverrideApplied).toBe(false);
    expect(canvas.selectedTool).toBe(pen);
  });

  it('defers a button press during contact until the pen lifts', () => {
    const { canvas, pen, eraser } = makeCanvas();
    canvas.penContactOpen = true;

    canvas.syncEraserOverride(penEvent('pointermove', 2, 3));
    expect(canvas.eraserButtonsHeld).toBe(true);
    expect(canvas.eraserOverrideApplied).toBe(false);
    expect(canvas.selectedTool).toBe(pen);

    canvas.syncEraserOverride(penEvent('pointermove', 0, 2));
    expect(canvas.eraserButtonsHeld).toBe(true);
    expect(canvas.eraserOverrideApplied).toBe(true);
    expect(canvas.selectedTool).toBe(eraser);
  });

  it('defers a button release during contact until the pen lifts', () => {
    const { canvas, pen, eraser } = makeCanvas();

    canvas.syncEraserOverride(penEvent('pointerdown', 2, 2));
    expect(canvas.selectedTool).toBe(eraser);
    canvas.syncEraserOverride(penEvent('pointerdown', 0, 3));
    canvas.penContactOpen = true;

    canvas.syncEraserOverride(penEvent('pointermove', 2, 1));
    expect(canvas.eraserButtonsHeld).toBe(false);
    expect(canvas.eraserOverrideApplied).toBe(true);
    expect(canvas.selectedTool).toBe(eraser);

    canvas.syncEraserOverride(penEvent('pointerup', 0, 0));
    expect(canvas.eraserOverrideApplied).toBe(false);
    expect(canvas.selectedTool).toBe(pen);
  });

  it('applies every button change immediately while the pen is lifted', () => {
    const { canvas, pen, eraser } = makeCanvas();

    canvas.syncEraserOverride(penEvent('pointerdown', 2, 2));
    expect(canvas.eraserButtonsHeld).toBe(true);
    expect(canvas.eraserOverrideApplied).toBe(true);
    expect(canvas.selectedTool).toBe(eraser);

    canvas.syncEraserOverride(penEvent('pointerup', 2, 0));
    expect(canvas.eraserButtonsHeld).toBe(false);
    expect(canvas.eraserOverrideApplied).toBe(false);
    expect(canvas.selectedTool).toBe(pen);

    canvas.syncEraserOverride(penEvent('pointerdown', 2, 2));
    expect(canvas.eraserButtonsHeld).toBe(true);
    expect(canvas.eraserOverrideApplied).toBe(true);
    expect(canvas.selectedTool).toBe(eraser);
  });

  it('resolves multiple deferred changes to the held state at lift', () => {
    const { canvas, eraser } = makeCanvas();
    canvas.penContactOpen = true;

    canvas.syncEraserOverride(penEvent('pointermove', -1, 3));
    canvas.syncEraserOverride(penEvent('pointermove', -1, 1));
    canvas.syncEraserOverride(penEvent('pointermove', -1, 3));
    expect(canvas.eraserButtonsHeld).toBe(true);
    expect(canvas.eraserOverrideApplied).toBe(false);

    canvas.syncEraserOverride(penEvent('pointermove', 0, 2));
    expect(canvas.eraserOverrideApplied).toBe(true);
    expect(canvas.selectedTool).toBe(eraser);
  });

  it('keeps erasing across contacts while the button remains held', () => {
    const { canvas, pen, eraser } = makeCanvas();

    canvas.syncEraserOverride(penEvent('pointerdown', 2, 2));
    canvas.syncEraserOverride(penEvent('pointerdown', 0, 3));
    canvas.penContactOpen = true;
    canvas.syncEraserOverride(penEvent('pointermove', 0, 2));
    canvas.penContactOpen = false;
    expect(canvas.selectedTool).toBe(eraser);

    canvas.syncEraserOverride(penEvent('pointerdown', 0, 3));
    expect(canvas.eraserButtonsHeld).toBe(true);
    expect(canvas.eraserOverrideApplied).toBe(true);
    expect(canvas.selectedTool).toBe(eraser);

    canvas.penContactOpen = true;
    canvas.syncEraserOverride(penEvent('pointermove', 0, 2));
    canvas.penContactOpen = false;
    canvas.syncEraserOverride(penEvent('pointerup', 2, 0));
    expect(canvas.selectedTool).toBe(pen);

    canvas.syncEraserOverride(penEvent('pointerdown', 2, 2));
    canvas.syncEraserOverride(penEvent('pointerdown', 0, 3));
    expect(canvas.selectedTool).toBe(eraser);
  });

  it('restores before a new contact that reports the button released', () => {
    const { canvas, pen, eraser } = makeCanvas();

    canvas.syncEraserOverride(penEvent('pointerdown', 2, 2));
    canvas.syncEraserOverride(penEvent('pointerdown', 0, 3));
    canvas.penContactOpen = true;
    canvas.syncEraserOverride(penEvent('pointerup', 0, 0));
    canvas.penContactOpen = false;
    expect(canvas.selectedTool).toBe(eraser);

    canvas.syncEraserOverride(penEvent('pointerdown', 0, 1));
    expect(canvas.eraserButtonsHeld).toBe(false);
    expect(canvas.eraserOverrideApplied).toBe(false);
    expect(canvas.selectedTool).toBe(pen);
  });

  it('preserves a native eraser signal across its contact lift', () => {
    const { canvas, pen, eraser } = makeCanvas();

    canvas.syncEraserOverride(penEvent('pointerdown', 5, 32));
    expect(canvas.selectedTool).toBe(eraser);
    canvas.penContactOpen = true;

    canvas.syncEraserOverride(penEvent('pointerup', 5, 0));
    canvas.penContactOpen = false;
    expect(canvas.eraserButtonsHeld).toBe(true);
    expect(canvas.eraserOverrideApplied).toBe(true);
    expect(canvas.selectedTool).toBe(eraser);

    canvas.syncEraserOverride(penEvent('pointerdown', 0, 1));
    expect(canvas.selectedTool).toBe(pen);
  });

  it('clears both states when the pen interaction is cancelled', () => {
    const { canvas, pen } = makeCanvas();

    canvas.syncEraserOverride(penEvent('pointerdown', 2, 2));
    canvas.penContactOpen = true;
    canvas.syncEraserOverride(penEvent('pointercancel', 0, 0));

    expect(canvas.eraserButtonsHeld).toBe(false);
    expect(canvas.eraserOverrideApplied).toBe(false);
    expect(canvas.selectedTool).toBe(pen);
  });
});

describe('moveElementOrderForSelection', () => {
  it('moves a selected element higher or lower by one step', () => {
    const items = order(
      ['frame', ElementType.PAGE_FRAME],
      ['a', ElementType.STROKE],
      ['b', ElementType.IMAGE],
      ['c', ElementType.TEXT],
    );

    expect(moveElementOrderForSelection(items, ['a'], 'higher')).toEqual([
      'frame',
      'b',
      'a',
      'c',
    ]);
    expect(moveElementOrderForSelection(items, ['b'], 'lower')).toEqual([
      'frame',
      'b',
      'a',
      'c',
    ]);
  });

  it('moves a multi-selection as one visual block', () => {
    const items = order(
      ['frame', ElementType.PAGE_FRAME],
      ['a', ElementType.STROKE],
      ['b', ElementType.IMAGE],
      ['c', ElementType.TEXT],
    );

    expect(moveElementOrderForSelection(items, ['a', 'b'], 'higher')).toEqual([
      'frame',
      'c',
      'a',
      'b',
    ]);
    expect(moveElementOrderForSelection(items, ['b', 'c'], 'lower')).toEqual([
      'frame',
      'b',
      'c',
      'a',
    ]);
  });

  it('shifts each selected element independently when selection is discontiguous', () => {
    const items = order(
      ['a', ElementType.STROKE],
      ['b', ElementType.STROKE],
      ['c', ElementType.STROKE],
      ['d', ElementType.STROKE],
    );

    expect(moveElementOrderForSelection(items, ['a', 'c'], 'higher')).toEqual([
      'b',
      'a',
      'd',
      'c',
    ]);
    expect(moveElementOrderForSelection(items, ['b', 'd'], 'lower')).toEqual([
      'b',
      'a',
      'd',
      'c',
    ]);
  });

  it('keeps background elements behind foreground elements', () => {
    const items = order(
      ['frame', ElementType.PAGE_FRAME],
      ['pdf', ElementType.PDF],
      ['stroke', ElementType.STROKE],
    );

    expect(canMoveElementOrderForSelection(items, ['pdf'], 'higher')).toBe(
      false,
    );
    expect(moveElementOrderForSelection(items, ['pdf'], 'higher')).toEqual([
      'frame',
      'pdf',
      'stroke',
    ]);
  });
});
