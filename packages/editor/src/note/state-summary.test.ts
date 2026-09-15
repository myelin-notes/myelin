import { describe, expect, it } from 'vitest';
import { ELEMENT_DESCRIPTORS } from '../elements/element-descriptors';
import { YDocManager } from '../ydoc-manager';
import { describeElementType, summarizeYDocManager } from './state-summary';

describe('state summary', () => {
  it('counts every registered element type by descriptor name', () => {
    const ydoc = new YDocManager();
    for (const descriptor of ELEMENT_DESCRIPTORS) {
      ydoc.createElementMap(descriptor.type, `${descriptor.name}-1`, {});
    }

    const summary = summarizeYDocManager(ydoc);

    expect(summary.elementCounts).toEqual(
      Object.fromEntries(
        ELEMENT_DESCRIPTORS.map((descriptor) => [descriptor.name, 1]),
      ),
    );
    expect(summary.unknownCount).toBe(0);
    expect(summary.strokeUuids).toEqual(['stroke-1']);
    expect(summary.pageFrameUuids).toEqual(['page-frame-1']);
  });

  it('labels unregistered types as unknown', () => {
    expect(describeElementType(999)).toBe('unknown:999');
  });
});
