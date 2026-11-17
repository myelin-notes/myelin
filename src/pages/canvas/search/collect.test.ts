import { describe, expect, it } from 'vitest';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { buildCanvasMatches, collectCanvasSearchSources } from './collect';

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

    expect(collectCanvasSearchSources(canvas)).toEqual([
      {
        kind: 'text',
        rect: { x: 10, y: 20, width: 30, height: 40 },
        selectUuids: ['searchable-element'],
        text: 'Capability content',
      },
    ]);
  });

  it('makes each PDF occurrence a match on its page', () => {
    const page = { x: 0, y: 30, width: 10, height: 20 };
    const canvas = {
      elements: [
        {
          uuid: 'pdf',
          boundingBox: { x: 0, y: 0, width: 10, height: 50 },
          getCanvasSearchContent: () => ({
            kind: 'pdf' as const,
            pages: [
              { position: 0, bounds: { x: 0, y: 0 }, text: 'no hit' },
              { position: 2, bounds: page, text: 'Fox and\nfox' },
            ],
          }),
        },
      ],
    } as unknown as DrawableCanvas;
    const match = {
      kind: 'pdf',
      rect: page,
      selectUuids: ['pdf'],
      frameUuid: 'pdf',
      pagePosition: 2,
    };

    expect(
      buildCanvasMatches(collectCanvasSearchSources(canvas), ' FOX '),
    ).toEqual([
      { ...match, ordinalInFrame: 0 },
      { ...match, ordinalInFrame: 1 },
    ]);
  });
});
