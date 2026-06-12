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

const EXACT_HANDLERS: Record<string, MediaImportHandler> = {
  'image/jpeg': imageImportHandler,
  'image/png': imageImportHandler,
  'application/pdf': pdfImportHandler,
  'text/markdown': markdownImportHandler,
  'text/x-markdown': markdownImportHandler,
};

// Any audio container is worth attempting: audioImportHandler tolerates
// undecodable input (duration stays 0), and the picker/clipboard filters
// admit audio/* broadly.
export function getMediaImportHandler(
  type: string,
): MediaImportHandler | undefined {
  return (
    EXACT_HANDLERS[type] ??
    (type.startsWith('audio/') ? audioImportHandler : undefined)
  );
}
