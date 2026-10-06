import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initProseMirrorDoc,
  prosemirrorToYXmlFragment,
  ySyncPlugin,
} from 'y-prosemirror';
import * as Y from 'yjs';
import type { DrawableCanvas } from '../drawable-canvas';
import { ImageElement } from '../elements/image-element';
import { PageFrameElement } from '../elements/page-frame-element';
import { getMediaImportHandler } from '../media';
import { imageImportHandler } from '../media/images';
import {
  PageFrameAnchoring,
  type PageFramePasteTarget,
} from '../page-frame/anchoring';
import { resolveAnchorPosition } from '../page-frame/pm/anchoring';
import type { PageFrameEditorState } from '../page-frame/pm/editor-state';
import { schema } from '../page-frame/pm/schema';
import { handlePageFrameImagePaste } from './page-frame-image-paste';

vi.mock('../utils', () => ({ getDevicePixelRatio: () => 1 }));
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('page');
  prosemirrorToYXmlFragment(
    schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('some text')),
    ]),
    fragment,
  );
  function state() {
    const { doc, mapping } = initProseMirrorDoc(fragment, schema);
    const state = EditorState.create({
      doc,
      plugins: [ySyncPlugin(fragment, { mapping })],
    });
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 3)),
    );
  }
  const view = {
    state: state(),
    dom: { contains: () => true },
  } as unknown as EditorView;
  const frame = new PageFrameElement('frame');
  frame.pmEditor = { view } as PageFrameEditorState;
  const images: ImageElement[] = [];
  const attachAtPosition = vi.fn(() => true);
  const canvas = {
    editingElement: frame,
    elements: [frame],
    addElement: (factory: (uuid: string) => ImageElement) => {
      const image = factory('image');
      images.push(image);
      return image;
    },
    removeElement: vi.fn(),
    transact: (fn: () => void) => fn(),
    anchoring: { attachAtPosition },
    ctx: { canvas: { width: 1000, height: 800 } },
    viewport: { screenToWorld: (point: { x: number; y: number }) => point },
  } as unknown as DrawableCanvas;
  function event(type: string, target: EventTarget | null = null) {
    const file = new File(['image'], 'clipboard.webp', { type });
    return {
      target,
      clipboardData: { items: [{ type, getAsFile: () => file }] },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as ClipboardEvent;
  }
  return {
    canvas,
    frame,
    view,
    fragment,
    state,
    event,
    images,
    attachAtPosition,
  };
}

describe('page-frame image MIME paste', () => {
  it('captures the text cursor and consumes image MIME data before the text editor handles it', () => {
    const { canvas, view, event } = fixture();
    const paste = vi.fn();
    const clipboardEvent = event('image/webp');
    expect(handlePageFrameImagePaste(clipboardEvent, canvas, paste)).toBe(true);
    expect(clipboardEvent.preventDefault).toHaveBeenCalledOnce();
    expect(clipboardEvent.stopPropagation).toHaveBeenCalledOnce();
    const [files, target] = paste.mock.calls[0] as [
      File[],
      PageFramePasteTarget,
    ];
    expect(files[0].type).toBe('image/webp');
    expect(target.frameId).toBe('frame');
    expect(resolveAnchorPosition(view.state, target.position)).toBe(3);
    expect(getMediaImportHandler(files[0].type)).toBe(imageImportHandler);
  });

  it('leaves text, other file types, and pastes outside the page editor alone', () => {
    const { canvas, view, event } = fixture();
    const paste = vi.fn();
    for (const type of ['text/plain', 'application/pdf', 'audio/wav']) {
      const clipboardEvent = event(type);
      expect(handlePageFrameImagePaste(clipboardEvent, canvas, paste)).toBe(
        false,
      );
      expect(clipboardEvent.preventDefault).not.toHaveBeenCalled();
    }
    vi.spyOn(view.dom, 'contains').mockReturnValue(false);
    expect(
      handlePageFrameImagePaste(
        event('image/png', new EventTarget()),
        canvas,
        paste,
      ),
    ).toBe(false);
    expect(paste).not.toHaveBeenCalled();
  });

  it('creates a usual image and anchors at the saved position after async loading and edits above', async () => {
    const {
      canvas,
      view,
      frame,
      fragment,
      state,
      event,
      images,
      attachAtPosition,
    } = fixture();
    vi.spyOn(ImageElement.prototype, 'setImageData').mockImplementation(
      async () => {
        const text = (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText;
        text.insert(0, 'added ');
        Object.assign(view, { state: state() });
      },
    );
    let pending: Promise<void> | undefined;
    handlePageFrameImagePaste(event('image/png'), canvas, (files, target) => {
      pending = imageImportHandler(files[0], canvas, {
        pageFramePaste: target,
      });
    });
    await pending;
    expect(images).toHaveLength(1);
    expect(images[0]).toBeInstanceOf(ImageElement);
    expect(images[0].makesSpace).toBe(true);
    expect(attachAtPosition).toHaveBeenCalledWith(images[0], frame, 9, true);
  });

  it('attaches at the supplied text position without coordinate hit-testing', () => {
    const { canvas, frame, view } = fixture();
    const anchors = new PageFrameAnchoring(canvas);
    vi.spyOn(anchors, 'refresh').mockImplementation(() => {});
    Object.assign(view, {
      coordsAtPos: vi.fn(() => ({ left: 90, top: 70 })),
      posAtCoords: vi.fn(() => {
        throw new Error('must use the saved cursor');
      }),
    });
    frame.mountDOM(
      {} as HTMLDivElement,
      {
        offsetWidth: 640,
        getBoundingClientRect: () => new DOMRect(0, 0, 640, 880),
      } as HTMLDivElement,
    );
    const image = new ImageElement('image');
    expect(anchors.attachAtPosition(image, frame, 3, true)).toBe(true);
    expect(image.pageAnchor?.frameId).toBe(frame.uuid);
    expect(resolveAnchorPosition(view.state, image.pageAnchor!.position)).toBe(
      3,
    );
    expect(image.offset.y).toBe(70);
    expect(view.posAtCoords).not.toHaveBeenCalled();
  });

  it('discards the imported image if its frame is deleted while it loads', async () => {
    const { canvas, event, images, attachAtPosition } = fixture();
    vi.spyOn(ImageElement.prototype, 'setImageData').mockImplementation(
      async () => {
        canvas.elements.splice(0);
      },
    );
    let pending: Promise<void> | undefined;
    handlePageFrameImagePaste(event('image/png'), canvas, (files, target) => {
      pending = imageImportHandler(files[0], canvas, {
        pageFramePaste: target,
      });
    });
    await pending;
    expect(canvas.removeElement).toHaveBeenCalledWith(images[0]);
    expect(attachAtPosition).not.toHaveBeenCalled();
  });

  it.each([
    { width: 1168, height: 200, frameScale: 1, expectedScale: 0.5 },
    { width: 200, height: 1568, frameScale: 1, expectedScale: 0.5 },
    { width: 100, height: 200, frameScale: 1, expectedScale: 1 },
    { width: 1168, height: 200, frameScale: 0.5, expectedScale: 0.25 },
  ])('fits a $width × $height image within the page at scale $frameScale', async ({
    width,
    height,
    frameScale,
    expectedScale,
  }) => {
    const { canvas, frame, event, images, attachAtPosition } = fixture();
    frame.setScale(frameScale, frameScale);
    vi.spyOn(ImageElement.prototype, 'setImageData').mockResolvedValue();
    vi.spyOn(ImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(
      width,
    );
    vi.spyOn(ImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(
      height,
    );
    attachAtPosition.mockImplementation(() => {
      expect(images[0].scale).toEqual({ x: expectedScale, y: expectedScale });
      return true;
    });
    let pending: Promise<void> | undefined;
    handlePageFrameImagePaste(event('image/png'), canvas, (files, target) => {
      pending = imageImportHandler(files[0], canvas, {
        pageFramePaste: target,
      });
    });
    await pending;
    expect(attachAtPosition).toHaveBeenCalledOnce();
  });

  it('keeps ordinary canvas image imports unanchored and centered', async () => {
    const { canvas, images, attachAtPosition } = fixture();
    vi.spyOn(ImageElement.prototype, 'setImageData').mockResolvedValue();
    vi.spyOn(ImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(
      200,
    );
    vi.spyOn(ImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(
      100,
    );
    await imageImportHandler(new Blob(['image']), canvas);
    expect(images[0].offset).toEqual({ x: 400, y: 350 });
    expect(images[0].pageAnchor).toBeNull();
    expect(attachAtPosition).not.toHaveBeenCalled();
  });
});
