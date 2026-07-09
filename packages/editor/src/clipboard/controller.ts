import { createCanvasPastePlacementTracker } from './placement';
import {
  buildCanvasClipboardSnapshot,
  parseCanvasClipboardSnapshot,
  serializeCanvasClipboardSnapshot,
} from './snapshot';
import {
  readCanvasClipboardPayload,
  writeCanvasClipboardPayload,
} from './system-clipboard';
import type { CanvasClipboardPort } from './types';

function isEditableClipboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') {
    return false;
  }

  const element = target as { tagName?: string; isContentEditable?: boolean };
  const tagName = element.tagName?.toUpperCase();
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    element.isContentEditable === true
  );
}

export type ClipboardMediaFallback = (event: ClipboardEvent) => boolean;

export class CanvasClipboardController {
  private readonly placementTracker = createCanvasPastePlacementTracker();

  public handleCopy(event: ClipboardEvent, port: CanvasClipboardPort): boolean {
    if (port.isEditing() || isEditableClipboardTarget(event.target)) {
      return false;
    }

    const selection = port.getSelection();
    if (!selection) {
      return false;
    }

    const snapshot = buildCanvasClipboardSnapshot(selection);
    const payload = serializeCanvasClipboardSnapshot(snapshot);
    if (!writeCanvasClipboardPayload(event, payload)) {
      return false;
    }

    event.preventDefault();
    return true;
  }

  public handleCut(event: ClipboardEvent, port: CanvasClipboardPort): boolean {
    const handled = this.handleCopy(event, port);
    if (!handled) {
      return false;
    }

    port.deleteSelection();
    return true;
  }

  public handlePaste(
    event: ClipboardEvent,
    port: CanvasClipboardPort,
    onMediaPaste?: ClipboardMediaFallback,
  ): boolean {
    if (port.isEditing() || isEditableClipboardTarget(event.target)) {
      return false;
    }

    const clipboardPayload = readCanvasClipboardPayload(event);
    if (clipboardPayload) {
      const snapshot = parseCanvasClipboardSnapshot(clipboardPayload);
      const context = snapshot ? port.getPasteContext() : null;
      if (!snapshot || !context) {
        return false;
      }

      const placement = this.placementTracker.next(
        snapshot,
        context,
        clipboardPayload,
      );
      const result = port.pasteSnapshot(snapshot, placement);
      if (!result) {
        return false;
      }

      event.preventDefault();
      return true;
    }

    if (onMediaPaste?.(event)) {
      event.preventDefault();
      return true;
    }

    return false;
  }
}
