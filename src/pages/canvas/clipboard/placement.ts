import type { VFSNodeId } from '@/lib/sync';
import type {
  CanvasClipboardSnapshot,
  CanvasPasteContext,
  CanvasPastePlacement,
  CanvasPoint,
} from './types';

const PASTE_NUDGE = 24;

function centerOfRect(
  rect: CanvasClipboardSnapshot['selectionBounds'],
): CanvasPoint {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function placementTranslation(
  snapshot: CanvasClipboardSnapshot,
  context: CanvasPasteContext,
  pasteCount: number,
): CanvasPoint {
  const nudge = PASTE_NUDGE * pasteCount;

  if (snapshot.sourceNoteId === context.noteId) {
    return { x: nudge, y: nudge };
  }

  const sourceCenter = centerOfRect(snapshot.selectionBounds);
  return {
    x: context.viewportCenter.x - sourceCenter.x + nudge,
    y: context.viewportCenter.y - sourceCenter.y + nudge,
  };
}

export interface CanvasPastePlacementTracker {
  next(
    snapshot: CanvasClipboardSnapshot,
    context: CanvasPasteContext,
    signature: string,
  ): CanvasPastePlacement;
}

export function createCanvasPastePlacementTracker(): CanvasPastePlacementTracker {
  let lastSignature: string | null = null;
  let lastDestinationNoteId: VFSNodeId | null = null;
  let pasteCount = 0;

  return {
    next(snapshot, context, signature) {
      if (
        signature === lastSignature &&
        context.noteId === lastDestinationNoteId
      ) {
        pasteCount += 1;
      } else {
        lastSignature = signature;
        lastDestinationNoteId = context.noteId;
        pasteCount = 1;
      }

      return {
        translate: placementTranslation(snapshot, context, pasteCount),
        pasteCount,
      };
    },
  };
}
