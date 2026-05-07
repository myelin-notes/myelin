import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { VFSNodeId } from '@/lib/sync';
import { ElementType } from '../elements/element-type';
import { CanvasClipboardController } from './controller';
import {
  buildCanvasClipboardSnapshot,
  serializeCanvasClipboardSnapshot,
} from './snapshot';
import type { CanvasClipboardPort, CanvasClipboardSelection } from './types';

class FakeClipboardData {
  private readonly data = new Map<string, string>();

  public readonly items: DataTransferItem[] = [];

  setData(type: string, value: string) {
    this.data.set(type, value);
  }

  getData(type: string): string {
    return this.data.get(type) ?? '';
  }
}

function createSelection(noteId: VFSNodeId): CanvasClipboardSelection {
  const doc = new Y.Doc();
  const elements = doc.getArray<Y.Map<unknown>>('elements');
  const yMap = new Y.Map<unknown>();
  yMap.set('type', ElementType.TEXT);
  yMap.set('uuid', 'text-1');
  yMap.set('offsetX', 10);
  yMap.set('offsetY', 20);
  yMap.set('scaleX', 1);
  yMap.set('scaleY', 1);
  yMap.set('text', 'Hello');
  yMap.set('color', '#111111');
  yMap.set('fontSize', 24);
  yMap.set('fontFamily', 'sans-serif');
  yMap.set('boxWidth', 200);
  yMap.set('boxHeight', 80);
  elements.push([yMap]);

  return {
    noteId,
    bounds: { x: 10, y: 20, width: 200, height: 80 },
    items: [
      {
        uuid: 'text-1',
        type: ElementType.TEXT,
        bounds: { x: 10, y: 20, width: 200, height: 80 },
        yMap,
      },
    ],
  };
}

function createClipboardEvent(
  type: 'copy' | 'cut' | 'paste',
  clipboardData = new FakeClipboardData(),
  target: EventTarget | null = null,
) {
  let defaultPrevented = false;
  return {
    type,
    clipboardData,
    target,
    preventDefault() {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
  } as ClipboardEvent & {
    readonly defaultPrevented: boolean;
    clipboardData: FakeClipboardData;
  };
}

function createPort(
  overrides?: Partial<CanvasClipboardPort>,
): CanvasClipboardPort {
  return {
    isEditing: () => false,
    getSelection: () => createSelection('note-1'),
    getPasteContext: () => ({
      noteId: 'note-1',
      viewportCenter: { x: 400, y: 300 },
    }),
    deleteSelection: vi.fn(),
    pasteSnapshot: vi.fn(() => ({ pastedElementUuids: ['paste-1'] })),
    ...overrides,
  };
}

describe('CanvasClipboardController', () => {
  it('writes the Myelin payload and sentinel text on copy', () => {
    const controller = new CanvasClipboardController();
    const event = createClipboardEvent('copy');
    const port = createPort();

    const handled = controller.handleCopy(event, port);

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(
      event.clipboardData.getData('application/x-myelin-canvas'),
    ).toContain('"version":1');
    expect(event.clipboardData.getData('text/plain')).toBe(
      '[Myelin canvas selection]',
    );
  });

  it('writes the clipboard payload and deletes the selection on cut', () => {
    const controller = new CanvasClipboardController();
    const event = createClipboardEvent('cut');
    const deleteSelection = vi.fn();
    const port = createPort({ deleteSelection });

    const handled = controller.handleCut(event, port);

    expect(handled).toBe(true);
    expect(deleteSelection).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('uses the Myelin clipboard payload before media fallback and nudges repeated pastes', () => {
    const controller = new CanvasClipboardController();
    const snapshot = buildCanvasClipboardSnapshot(createSelection('note-1'));
    const payload = serializeCanvasClipboardSnapshot(snapshot);
    const pasteSnapshot = vi.fn(() => ({ pastedElementUuids: ['paste-1'] }));
    const onMediaPaste = vi.fn(() => false);
    const port = createPort({ pasteSnapshot });

    const firstPaste = createClipboardEvent('paste');
    firstPaste.clipboardData.setData('application/x-myelin-canvas', payload);
    const secondPaste = createClipboardEvent('paste');
    secondPaste.clipboardData.setData('application/x-myelin-canvas', payload);

    expect(controller.handlePaste(firstPaste, port, onMediaPaste)).toBe(true);
    expect(controller.handlePaste(secondPaste, port, onMediaPaste)).toBe(true);

    expect(onMediaPaste).not.toHaveBeenCalled();
    expect(pasteSnapshot).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sourceNoteId: 'note-1' }),
      expect.objectContaining({ translate: { x: 24, y: 24 }, pasteCount: 1 }),
    );
    expect(pasteSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sourceNoteId: 'note-1' }),
      expect.objectContaining({ translate: { x: 48, y: 48 }, pasteCount: 2 }),
    );
  });

  it('falls back to media paste when no Myelin payload exists', () => {
    const controller = new CanvasClipboardController();
    const event = createClipboardEvent('paste');
    const onMediaPaste = vi.fn(() => true);
    const port = createPort();

    expect(controller.handlePaste(event, port, onMediaPaste)).toBe(true);
    expect(onMediaPaste).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not intercept editable targets', () => {
    const controller = new CanvasClipboardController();
    const target = { tagName: 'TEXTAREA' } as unknown as EventTarget;
    const event = createClipboardEvent('copy', new FakeClipboardData(), target);
    const port = createPort();

    expect(controller.handleCopy(event, port)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});
