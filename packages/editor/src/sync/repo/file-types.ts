export const ImageFileTypes = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'svg',
  'bmp',
] as const;
export const VideoFileTypes = [
  'mp4',
  'mov',
  'm4v',
  'webm',
  'avi',
  'mkv',
] as const;
export const DataFileTypes = ['csv'] as const;
export const FileTypes = [
  'mcanvas',
  ...ImageFileTypes,
  ...VideoFileTypes,
  ...DataFileTypes,
] as const;
export type FileType = (typeof FileTypes)[number];

const FILE_TYPE_SET = new Set<string>(FileTypes);
const IMAGE_FILE_TYPE_SET = new Set<string>(ImageFileTypes);
const VIDEO_FILE_TYPE_SET = new Set<string>(VideoFileTypes);
const DATA_FILE_TYPE_SET = new Set<string>(DataFileTypes);

const MIME_TYPE_BY_FILE_TYPE: Record<FileType, string> = {
  mcanvas: 'application/octet-stream',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  csv: 'text/csv',
};

export function isSupportedFileType(value: string): value is FileType {
  return FILE_TYPE_SET.has(value);
}

export function isImageFileType(fileType: FileType): boolean {
  return IMAGE_FILE_TYPE_SET.has(fileType);
}

export function isVideoFileType(fileType: FileType): boolean {
  return VIDEO_FILE_TYPE_SET.has(fileType);
}

export function isDataFileType(fileType: FileType): boolean {
  return DATA_FILE_TYPE_SET.has(fileType);
}

export function getFileTypeForName(name: string): FileType | null {
  const extension = name.split('.').pop()?.toLowerCase();
  if (!extension || !isSupportedFileType(extension)) {
    return null;
  }
  return extension;
}

export function getMimeTypeForFileType(fileType: FileType): string {
  return MIME_TYPE_BY_FILE_TYPE[fileType];
}
