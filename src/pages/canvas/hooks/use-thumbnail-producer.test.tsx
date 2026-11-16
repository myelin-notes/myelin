import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { setPlatform } from '@myelin/editor/platform';
import {
  regenerateThumbnailNow,
  requestThumbnailRegeneration,
} from '@myelin/editor/thumbnails';
import type { VFSNodeId } from '@/lib/sync';
import { useCanvasThumbnailProducer } from './use-thumbnail-producer';

const { renderCanvasThumbnail } = vi.hoisted(() => ({
  renderCanvasThumbnail: vi.fn(),
}));

vi.unmock('@myelin/editor/thumbnails');
vi.mock('@myelin/editor/canvas-thumbnail', () => ({ renderCanvasThumbnail }));

const write = vi.fn(async () => {});
const thumbnailRootRef = { current: null };

function canvasFor(noteId: string): DrawableCanvas {
  return {
    elements: [noteId],
    viewport: { getWorldRect: () => ({}) },
  } as unknown as DrawableCanvas;
}

function Harness({
  id,
  drawableCanvasRef,
}: {
  id: VFSNodeId;
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>;
}) {
  useCanvasThumbnailProducer({ id, drawableCanvasRef, thumbnailRootRef });
  return null;
}

let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  renderCanvasThumbnail.mockReset();
  renderCanvasThumbnail.mockImplementation(async () => new Blob(['image']));
  write.mockClear();
  setPlatform({
    artifactCache: {
      getUrl: async () => null,
      read: async () => null,
      write,
      remove: async () => {},
    },
  } as never);
  const ownerDocument = {
    nodeType: 9,
    addEventListener: () => {},
    defaultView: { document: {}, HTMLIFrameElement: class {} },
  };
  root = createRoot({
    nodeType: 1,
    tagName: 'DIV',
    ownerDocument,
    addEventListener: () => {},
  } as unknown as HTMLElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('renders a closing note from its own canvas', async () => {
  const drawableCanvasRef = { current: canvasFor('note-a') };
  await act(async () => {
    root.render(<Harness id="note-a" drawableCanvasRef={drawableCanvasRef} />);
  });

  requestThumbnailRegeneration('note-a');
  await act(async () => {
    root.unmount();
  });

  expect(
    renderCanvasThumbnail.mock.calls.map(([elements]) => elements),
  ).toEqual([['note-a']]);
  await vi.waitFor(() => {
    expect(write).toHaveBeenCalledWith(
      'Thumbnails/note-a.png',
      expect.any(Blob),
    );
  });
});

it("never saves the next note's canvas as the closed note's thumbnail", async () => {
  const drawableCanvasRef: React.RefObject<DrawableCanvas | null> = {
    current: canvasFor('note-a'),
  };
  await act(async () => {
    root.render(<Harness id="note-a" drawableCanvasRef={drawableCanvasRef} />);
  });
  let finishFirstRender!: (blob: Blob) => void;
  renderCanvasThumbnail.mockImplementationOnce(
    () =>
      new Promise<Blob>((resolve) => {
        finishFirstRender = resolve;
      }),
  );

  const firstRender = regenerateThumbnailNow('note-a');
  // An edit during that render leaves a flush waiting on it when the tab switches to note-b.
  requestThumbnailRegeneration('note-a');
  await act(async () => {
    root.render(<Harness id="note-b" drawableCanvasRef={drawableCanvasRef} />);
  });
  drawableCanvasRef.current = canvasFor('note-b');
  finishFirstRender(new Blob(['note-a image']));
  await firstRender;
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(
    renderCanvasThumbnail.mock.calls.map(([elements]) => elements),
  ).toEqual([['note-a']]);
  expect(write).toHaveBeenCalledOnce();

  await act(async () => {
    root.unmount();
  });
});
