import type { Repository } from '@/lib/sync';
import type { DrawableCanvas } from '../drawable-canvas';
import { imageImportHandler } from './images';
import { markdownImportHandler } from './markdown';
import { pdfImportHandler } from './pdf';

export interface MediaImportOptions {
  repository?: Pick<Repository, 'searchNodes'>;
  screenX?: number;
  screenY?: number;
}

export type MediaImportHandler = (
  blob: Blob,
  canvas: DrawableCanvas,
  options?: MediaImportOptions,
) => void;

export const SUPPORTED_MEDIA: Record<string, MediaImportHandler> = {
  'image/jpeg': imageImportHandler,
  'image/png': imageImportHandler,
  'application/pdf': pdfImportHandler,
  'text/markdown': markdownImportHandler,
  'text/x-markdown': markdownImportHandler,
};
