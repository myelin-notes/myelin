import type { EditorView } from 'prosemirror-view';

export interface CodeRunLine {
  text: string;
  stream: 'stdout' | 'stderr';
}

export type CodeRunStatus = 'running' | 'ok' | 'error';

export interface CodeRunEntry {
  /** Stable per code-block node view; one overlay per block. */
  id: string;
  view: EditorView;
  blockDom: HTMLElement;
  lines: CodeRunLine[];
  status: CodeRunStatus;
  visible: boolean;
}

/**
 * Line appends are coalesced to at most one notify per this interval. The
 * overlay re-render is O(line count) (the virtualizer rebuilds its offsets), so
 * pacing updates well below the display refresh rate keeps a flood of output
 * from saturating the main thread — ~15 Hz still reads as continuous streaming.
 */
const OUTPUT_FLUSH_MS = 64;

/**
 * Bridges the vanilla code-block node views to the React output overlay layer.
 * Node views push run state here; {@link CodeRunOverlayLayer} renders it. Line
 * appends are coalesced (see {@link OUTPUT_FLUSH_MS}) so a flood of output
 * doesn't trigger a render per line.
 */
class CodeRunStore {
  private readonly entries = new Map<string, CodeRunEntry>();
  private readonly listeners = new Set<() => void>();
  private snapshot: CodeRunEntry[] = [];
  private dirty = true;
  private flushScheduled = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CodeRunEntry[] => {
    if (this.dirty) {
      this.snapshot = Array.from(this.entries.values());
      this.dirty = false;
    }
    return this.snapshot;
  };

  start(id: string, view: EditorView, blockDom: HTMLElement): void {
    this.entries.set(id, {
      id,
      view,
      blockDom,
      lines: [],
      status: 'running',
      visible: true,
    });
    this.emit();
  }

  appendLine(id: string, line: CodeRunLine): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    // Mutate in place (O(1)); the snapshot array identity still changes on the
    // batched notify, and the overlay re-reads `lines.length`.
    entry.lines.push(line);
    this.scheduleEmit();
  }

  /** Append a coalesced batch of lines with a single notify. */
  appendLines(id: string, lines: CodeRunLine[]): void {
    const entry = this.entries.get(id);
    if (!entry || lines.length === 0) {
      return;
    }
    for (const line of lines) {
      entry.lines.push(line);
    }
    this.scheduleEmit();
  }

  setStatus(id: string, status: CodeRunStatus): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    entry.status = status;
    this.emit();
  }

  setVisible(id: string, visible: boolean): void {
    const entry = this.entries.get(id);
    if (!entry || entry.visible === visible) {
      return;
    }
    entry.visible = visible;
    this.emit();
  }

  remove(id: string): void {
    if (this.entries.delete(id)) {
      this.emit();
    }
  }

  private emit(): void {
    this.dirty = true;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private scheduleEmit(): void {
    this.dirty = true;
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      for (const listener of this.listeners) {
        listener();
      }
    }, OUTPUT_FLUSH_MS);
  }
}

export const codeRunStore = new CodeRunStore();
