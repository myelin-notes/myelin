import type { DrawableCanvas } from '../drawable-canvas';
import type { NoteLinkResolveSource } from '../page-frame/note-link/resolution';
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
};
