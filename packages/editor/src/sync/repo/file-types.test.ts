import { describe, expect, it } from 'vitest';
import {
  FileTypeDescriptors,
  getFileIconKind,
  getFileTypeDescriptor,
  getFileViewer,
  getMimeTypeForFileType,
  isImportableFileType,
  isSupportedFileType,
} from './file-types';

describe('file type descriptors', () => {
  it.each(
    FileTypeDescriptors,
  )('defines MIME type, import policy, icon, and viewer for .$extension', (descriptor) => {
    expect(isSupportedFileType(descriptor.extension)).toBe(true);
    expect(getFileTypeDescriptor(descriptor.extension)).toMatchObject(
      descriptor,
    );
    expect(getMimeTypeForFileType(descriptor.extension)).toBe(
      descriptor.mimeType,
    );
    expect(isImportableFileType(descriptor.extension)).toBe(
      descriptor.importable,
    );
    expect(getFileIconKind(descriptor.extension)).toBe(descriptor.iconKind);
    expect(getFileViewer(descriptor.extension)).toBe(descriptor.viewer);
  });

  it.each(
    FileTypeDescriptors.filter((descriptor) => descriptor.importable),
  )('assigns .$extension an intentional non-canvas viewer', (descriptor) => {
    expect(descriptor.viewer).not.toBe('canvas');
  });
});
