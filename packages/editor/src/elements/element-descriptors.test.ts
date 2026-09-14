import { describe, expect, it } from 'vitest';
import {
  ELEMENT_DESCRIPTORS,
  ELEMENT_FACTORIES,
  getElementDescriptor,
} from './element-descriptors';
import { ElementType } from './element-type';

describe('element descriptors', () => {
  it('covers every persisted element type with a stable name, factory, and external policy', () => {
    const persistedTypes = Object.values(ElementType).filter(
      (value): value is ElementType => typeof value === 'number',
    );

    expect(
      ELEMENT_DESCRIPTORS.map((descriptor) => descriptor.type).sort(),
    ).toEqual(persistedTypes.sort());
    expect(
      new Set(ELEMENT_DESCRIPTORS.map((descriptor) => descriptor.name)).size,
    ).toBe(ELEMENT_DESCRIPTORS.length);

    for (const descriptor of ELEMENT_DESCRIPTORS) {
      expect(getElementDescriptor(descriptor.type)).toBe(descriptor);
      expect(ELEMENT_FACTORIES[descriptor.type]).toBe(descriptor.create);
      expect(descriptor.externalSummary).toMatch(
        /^(supported|grouped|unknown-compatible)$/,
      );
    }
  });
});
