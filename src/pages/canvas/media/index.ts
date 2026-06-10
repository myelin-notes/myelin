import type { DrawableCanvas } from '../drawable-canvas';
import type { NoteLinkResolveSource } from '../page-frame/note-link/resolution';
import { audioImportHandler } from './audio';
import { imageImportHandler } from './images';
import { markdownImportHandler } from './markdown';
import { pdfImportHandler } from './pdf';

export interface MediaImportOptions {
  repository?: NoteLinkResolveSource;
  screenX?: number;
  screenY?: number;
}

export type MediaImportHandler = (
  blob: Blob,
  canvas: DrawableCanvas,
  options?: MediaImportOptions,
) => void | Promise<void>;

export const SUPPORTED_MEDIA: Record<string, MediaImportHandler> = {
  'image/jpeg': imageImportHandler,
  'image/png': imageImportHandler,
  'application/pdf': pdfImportHandler,
  'text/markdown': markdownImportHandler,
  'text/x-markdown': markdownImportHandler,
  'audio/mpeg': audioImportHandler,
  'audio/mp4': audioImportHandler,
  'audio/ogg': audioImportHandler,
  'audio/wav': audioImportHandler,
  'audio/webm': audioImportHandler,
  'audio/flac': audioImportHandler,
  'audio/aac': audioImportHandler,
  'audio/x-m4a': audioImportHandler,
};
