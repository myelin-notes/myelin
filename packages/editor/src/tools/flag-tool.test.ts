import { describe, expect, it } from 'vitest';
import { CanvasDocumentBinding } from '../canvas-document-binding';
import type { DrawableCanvas } from '../drawable-canvas';
import type { DrawableElement } from '../elements/drawable-element';
import { getElementDescriptor } from '../elements/element-descriptors';
import { ElementType } from '../elements/element-type';
import { resolveFlagType } from '../elements/flag-element';
import { PdfElement } from '../elements/pdf';
import { catalogs } from '../i18n/messages';
import { YDocManager } from '../ydoc-manager';
import { FlagTool } from './flag-tool';
import { setToolOption } from './tool';

function makeCanvas() {
  const ydoc = new YDocManager();
  const binding = new CanvasDocumentBinding({
    ydoc,
    createElementFromYMap: (yMap) => {
      const element =
        getElementDescriptor(yMap.get('type') as number)?.create(
          yMap.get('uuid') as string,
        ) ?? null;
      element?.bindToYMap(yMap);
      return element;
    },
    initializeElement: (element, yMap) => element.bindToYMap(yMap),
    onChange: () => {},
    onRemoteChange: () => {},
    onElementRemoved: () => {},
  });
  binding.hydrate();
  const canvas = {
    get elements() {
      return binding.elements;
    },
    addElement: (factory: (uuid: string) => DrawableElement) =>
      binding.addElement(factory, undefined),
    transact: (fn: () => void) => binding.transact(fn),
    viewport: {
      zoom: 1,
      getPoint: (event: PointerEvent) => ({
        x: event.clientX,
        y: event.clientY,
      }),
    },
    anchoring: { findFrame: () => null },
    resolveFlagType: (id: string) =>
      resolveFlagType(
        [
          { id: 'todo', name: 'To-do', color: '#ef4444' },
          { id: 'review', name: 'Review', color: '#eab308' },
        ],
        id,
      ),
  } as unknown as DrawableCanvas;
  return { canvas, ydoc, binding };
}

function click(tool: FlagTool, canvas: DrawableCanvas, x: number, y: number) {
  tool.start(canvas, { clientX: x, clientY: y } as PointerEvent);
  tool.finish(canvas, { clientX: x + 1, clientY: y } as PointerEvent);
}

function savedFlags(ydoc: YDocManager) {
  return ydoc.elements
    .toArray()
    .map((yMap) => yMap.toJSON())
    .filter((json) => json.type === ElementType.FLAG);
}

describe('FlagTool', () => {
  it('saves a clicked flag with the keys the folder flag index reads', () => {
    const { canvas, ydoc, binding } = makeCanvas();
    const pdf = binding.addElement((uuid) => new PdfElement(uuid), undefined);
    const page = pdf.getPageBounds(0)!;
    const tool = new FlagTool(() => catalogs.en);
    setToolOption(tool, 'flagType', 'review');

    click(tool, canvas, page.x + 10, page.y + 10);
    click(tool, canvas, page.right + 500, page.bottom + 500);
    tool.start(canvas, { clientX: 0, clientY: 0 } as PointerEvent);
    tool.finish(canvas, { clientX: 80, clientY: 80 } as PointerEvent);

    expect(savedFlags(ydoc)).toEqual([
      expect.objectContaining({
        uuid: expect.any(String),
        offsetX: page.x + 10,
        offsetY: page.y + 10,
        label: `${pdf.fileName} · p.1`,
        flagTypeId: 'review',
      }),
      expect.objectContaining({ uuid: expect.any(String), label: '' }),
    ]);
  });

  it('places a deleted active type as the first remaining type', () => {
    const { canvas, ydoc } = makeCanvas();
    const tool = new FlagTool(() => catalogs.en);
    setToolOption(tool, 'flagType', 'deleted');

    click(tool, canvas, 0, 0);

    expect(savedFlags(ydoc)).toEqual([
      expect.objectContaining({ flagTypeId: 'todo' }),
    ]);
  });
});
