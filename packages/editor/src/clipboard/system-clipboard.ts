import {
  MYELIN_CANVAS_CLIPBOARD_LABEL,
  MYELIN_CANVAS_CLIPBOARD_MIME,
} from './formats';

export function writeCanvasClipboardPayload(
  event: ClipboardEvent,
  payload: string,
): boolean {
  const clipboardData = event.clipboardData;
  if (!clipboardData) {
    return false;
  }

  clipboardData.setData(MYELIN_CANVAS_CLIPBOARD_MIME, payload);
  clipboardData.setData('text/plain', MYELIN_CANVAS_CLIPBOARD_LABEL);
  return true;
}

export function readCanvasClipboardPayload(
  event: ClipboardEvent,
): string | null {
  const clipboardData = event.clipboardData;
  if (!clipboardData) {
    return null;
  }

  const payload = clipboardData.getData(MYELIN_CANVAS_CLIPBOARD_MIME);
  return payload || null;
}
