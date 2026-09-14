import { describe, expect, it } from 'vitest';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { collectCanvasSearchSources } from './collect';

describe('collectCanvasSearchSources', () => {
  it('uses an element search capability without checking its concrete type', () => {
    const canvas = {
      elements: [
        {
          uuid: 'searchable-element',
          boundingBox: { x: 10, y: 20, width: 30, height: 40 },
          getCanvasSearchContent: () => ({
            kind: 'text' as const,
            text: 'Capability content',
          }),
        },
      ],
    } as unknown as DrawableCanvas;

    expect(collectCanvasSearchSources(canvas, null)).toEqual([
      {
        kind: 'text',
        rect: { x: 10, y: 20, width: 30, height: 40 },
        selectUuids: ['searchable-element'],
        text: 'Capability content',
      },
    ]);
  });
});
