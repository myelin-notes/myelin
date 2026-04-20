import type { DrawableCanvas } from '../drawable-canvas';
import { imageImportHandler } from './images';
import { markdownImportHandler } from './markdown';
import { pdfImportHandler } from './pdf';

export type MediaImportHandler = (
  blob: Blob,
  canvas: DrawableCanvas,
  screenX?: number,
  screenY?: number,
) => void;

export const SUPPORTED_MEDIA: Record<string, MediaImportHandler> = {
  'image/jpeg': imageImportHandler,
  'image/png': imageImportHandler,
  'application/pdf': pdfImportHandler,
  'text/markdown': markdownImportHandler,
  'text/x-markdown': markdownImportHandler,
};
