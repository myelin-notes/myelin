import { describe, expect, it } from 'vitest';
import { FileTypeDescriptors } from './file-types';

describe('file type descriptors', () => {
  it.each(
    FileTypeDescriptors.filter((descriptor) => descriptor.importable),
  )('assigns .$extension an intentional non-canvas viewer', (descriptor) => {
    expect(descriptor.viewer).not.toBe('canvas');
  });
});
