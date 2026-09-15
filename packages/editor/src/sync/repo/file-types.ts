export type FileCategory = 'canvas' | 'image' | 'video' | 'data';
export type FileIconKind = 'document' | 'image' | 'video' | 'table';
export type FileViewer = 'canvas' | 'image' | 'csv' | 'unsupported';

interface FileTypeDescriptorDefinition {
  extension: string;
  category: FileCategory;
  mimeType: string;
  importable: boolean;
  iconKind: FileIconKind;
  viewer: FileViewer;
}

export const FileTypeDescriptors = [
  {
    extension: 'mcanvas',
    category: 'canvas',
    mimeType: 'application/octet-stream',
    importable: false,
    iconKind: 'document',
    viewer: 'canvas',
  },
  {
    extension: 'jpg',
    category: 'image',
    mimeType: 'image/jpeg',
    importable: true,
    iconKind: 'image',
    viewer: 'image',
  },
  {
    extension: 'jpeg',
    category: 'image',
    mimeType: 'image/jpeg',
    importable: true,
    iconKind: 'image',
    viewer: 'image',
  },
  {
    extension: 'png',
    category: 'image',
    mimeType: 'image/png',
    importable: true,
    iconKind: 'image',
    viewer: 'image',
  },
  {
    extension: 'gif',
    category: 'image',
    mimeType: 'image/gif',
    importable: true,
    iconKind: 'image',
    viewer: 'image',
  },
  {
    extension: 'webp',
    category: 'image',
    mimeType: 'image/webp',
    importable: true,
    iconKind: 'image',
    viewer: 'image',
  },
  {
    extension: 'avif',
    category: 'image',
    mimeType: 'image/avif',
    importable: true,
    iconKind: 'image',
    viewer: 'image',
  },
  {
    extension: 'svg',
    category: 'image',
    mimeType: 'image/svg+xml',
    importable: true,
    iconKind: 'image',
    viewer: 'image',
  },
  {
    extension: 'bmp',
    category: 'image',
    mimeType: 'image/bmp',
    importable: true,
    iconKind: 'image',
    viewer: 'image',
  },
  {
    extension: 'mp4',
    category: 'video',
    mimeType: 'video/mp4',
    importable: true,
    iconKind: 'video',
    viewer: 'unsupported',
  },
  {
    extension: 'mov',
    category: 'video',
    mimeType: 'video/quicktime',
    importable: true,
    iconKind: 'video',
    viewer: 'unsupported',
  },
  {
    extension: 'm4v',
    category: 'video',
    mimeType: 'video/x-m4v',
    importable: true,
    iconKind: 'video',
    viewer: 'unsupported',
  },
  {
    extension: 'webm',
    category: 'video',
    mimeType: 'video/webm',
    importable: true,
    iconKind: 'video',
    viewer: 'unsupported',
  },
  {
    extension: 'avi',
    category: 'video',
    mimeType: 'video/x-msvideo',
    importable: true,
    iconKind: 'video',
    viewer: 'unsupported',
  },
  {
    extension: 'mkv',
    category: 'video',
    mimeType: 'video/x-matroska',
    importable: true,
    iconKind: 'video',
    viewer: 'unsupported',
  },
  {
    extension: 'csv',
    category: 'data',
    mimeType: 'text/csv',
    importable: true,
    iconKind: 'table',
    viewer: 'csv',
  },
] as const satisfies readonly FileTypeDescriptorDefinition[];

export type FileType = (typeof FileTypeDescriptors)[number]['extension'];

export interface FileTypeDescriptor {
  extension: FileType;
  category: FileCategory;
  mimeType: string;
  importable: boolean;
  iconKind: FileIconKind;
  viewer: FileViewer;
}

export const FileTypes: readonly FileType[] = FileTypeDescriptors.map(
  (descriptor) => descriptor.extension,
);
export const ImageFileTypes = fileTypesForCategory('image');
export const VideoFileTypes = fileTypesForCategory('video');
export const DataFileTypes = fileTypesForCategory('data');
export const ImportableFileTypes = FileTypes.filter(isImportableFileType);

const FILE_TYPE_SET = new Set<string>(FileTypes);

export function isSupportedFileType(value: string): value is FileType {
  return FILE_TYPE_SET.has(value);
}

export function getFileTypeDescriptor(fileType: FileType): FileTypeDescriptor {
  const descriptor = FileTypeDescriptors.find(
    (candidate) => candidate.extension === fileType,
  );
  if (!descriptor) {
    throw new Error(`Unsupported file type: ${fileType}`);
  }
  return descriptor;
}

export function isImageFileType(fileType: FileType): boolean {
  return getFileTypeDescriptor(fileType).category === 'image';
}

export function isVideoFileType(fileType: FileType): boolean {
  return getFileTypeDescriptor(fileType).category === 'video';
}

export function isDataFileType(fileType: FileType): boolean {
  return getFileTypeDescriptor(fileType).category === 'data';
}

export function isImportableFileType(fileType: FileType): boolean {
  return getFileTypeDescriptor(fileType).importable;
}

export function getFileTypeForName(name: string): FileType | null {
  const extension = name.split('.').pop()?.toLowerCase();
  if (!extension || !isSupportedFileType(extension)) {
    return null;
  }
  return extension;
}

export function getMimeTypeForFileType(fileType: FileType): string {
  return getFileTypeDescriptor(fileType).mimeType;
}

export function getFileIconKind(fileType: FileType): FileIconKind {
  return getFileTypeDescriptor(fileType).iconKind;
}

export function getFileViewer(fileType: FileType): FileViewer {
  return getFileTypeDescriptor(fileType).viewer;
}

function fileTypesForCategory(category: FileCategory): readonly FileType[] {
  return FileTypeDescriptors.filter(
    (descriptor) => descriptor.category === category,
  ).map((descriptor) => descriptor.extension);
}
