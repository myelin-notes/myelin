import type {
  HandwritingCapability,
  RecognizedLine,
} from '@myelin/editor/platform/types';
import { isMac } from '@myelin/shared/os';
import type { VFSNodeId } from '@/lib/sync';
import { roundBounds } from './bounds';
import type {
  McpHandwritingLine,
  McpHandwritingReadModel,
  McpHandwritingStatus,
} from './types';

// Handwriting OCR is backed by Apple's Vision framework (`tauri-plugin-ocr`), which has no
// counterpart elsewhere — recognition returns no text there. Stroke clustering still runs
// everywhere, so line geometry is trustworthy even when the text is not.
const RECOGNITION_SUPPORTED = isMac;

const STATUS_NOTES: Record<McpHandwritingStatus, string> = {
  recognized:
    "Text was produced by handwriting OCR and may contain recognition errors. Call screenshot_canvas over a line's bounds to check anything that reads oddly or matters.",
  'text-unavailable': RECOGNITION_SUPPORTED
    ? 'Handwriting was found and its lines located, but no text could be recognized from any of them. Read it with screenshot_canvas over the line bounds below.'
    : 'Handwriting recognition is only available on macOS, so this device produced no text. The line bounds below are still accurate: pass them to screenshot_canvas and read the ink yourself. Do not report this note as having no handwriting.',
  'no-handwriting':
    'Recognition has run over this note and found no ink in it. This note genuinely contains no handwriting; any text it holds is in page frames, canvas text, or LaTeX.',
  'not-recognized':
    'No recognition artifact exists for this note, so nothing is known about its ink either way - recognition may simply not have run yet. Check read_note for elements of kind "stroke" and read any it lists with screenshot_canvas.',
};

// An artifact with no lines is a real answer (recognition ran and clustered no ink); a missing
// artifact is not, so the two must not collapse into one status.
function statusFor(
  hasArtifact: boolean,
  lines: readonly { text: string }[],
): McpHandwritingStatus {
  if (lines.length === 0) {
    return hasArtifact ? 'no-handwriting' : 'not-recognized';
  }
  return lines.some((line) => line.text.trim().length > 0)
    ? 'recognized'
    : 'text-unavailable';
}

function toLine(line: RecognizedLine): McpHandwritingLine {
  const [x, y, width, height] = line.bbox;
  return {
    text: line.text,
    bounds: roundBounds({ x, y, width, height }),
    strokeCount: line.strokeIds.length,
  };
}

// Every clustered line is returned, even one that recognized as empty: its bounds are what makes a
// follow-up screenshot possible.
export async function readMcpHandwriting(
  handwriting: HandwritingCapability | undefined,
  noteId: VFSNodeId,
): Promise<McpHandwritingReadModel> {
  const page = handwriting ? await handwriting.readPage(noteId) : null;
  const lines = (page?.lines ?? []).map(toLine);
  const status = statusFor(page !== null, lines);

  return {
    noteId,
    status,
    recognitionSupported: RECOGNITION_SUPPORTED,
    note: STATUS_NOTES[status],
    lineCount: lines.length,
    recognizedAt: page?.updatedAt ?? null,
    lines,
  };
}
