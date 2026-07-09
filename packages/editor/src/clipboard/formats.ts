export const MYELIN_CANVAS_CLIPBOARD_MIME = 'application/x-myelin-canvas';
export const MYELIN_CANVAS_CLIPBOARD_LABEL = '[Myelin canvas selection]';

export function isMyelinCanvasClipboardType(type: string): boolean {
  return type === MYELIN_CANVAS_CLIPBOARD_MIME;
}
