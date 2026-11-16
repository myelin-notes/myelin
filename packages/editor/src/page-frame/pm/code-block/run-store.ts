import type {
  RunnableLanguage,
  RunOutputLine,
} from '../../../code-runner/contract';

/** A parsed Jupyter-style MIME bundle. */
export interface CodeRunDisplay {
  kind: 'display';
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type CodeRunItem = RunOutputLine | CodeRunDisplay;

export interface CodeRunResult {
  exitCode: number | null;
  durationMs: number;
  error: string | null;
  cancelled: boolean;
}

/** State of one run, keyed by the block's stable id. In-memory only — never persisted or synced. */
export interface CodeRunSession {
  blockId: string;
  language: RunnableLanguage;
  items: CodeRunItem[];
  /** Items dropped off the front of `items` at the cap. */
  dropped: number;
  running: boolean;
  startedAt: number;
  /** Null while running. */
  result: CodeRunResult | null;
  /** Cancels the run; wired by the owning run button so the output card's stop button works. */
  stop: () => void;
}

// The card re-render is O(line count) (the virtualizer rebuilds its offsets), so pacing well
// below the display refresh rate keeps a flood of output from saturating the main thread — ~15 Hz
// still reads as continuous streaming.
const OUTPUT_FLUSH_MS = 64;

/** Items a session keeps; older ones are dropped and reported as `dropped`. */
const MAX_ITEMS = 2000;

// Bridges the vanilla code-block run buttons to the React output cards on the canvas. Run views
// push output here; CodeOutputCardView subscribes per block id.
class CodeRunStore {
  private readonly sessions = new Map<string, CodeRunSession>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  /** Per-session version, bumped on every notify that touched it. */
  private readonly versions = new Map<string, number>();
  private flushScheduled = false;
  private readonly pendingBlockIds = new Set<string>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Changes whenever the session for `blockId` starts, streams, or ends — snapshot for React. */
  getVersion = (blockId: string): number => this.versions.get(blockId) ?? -1;

  getSession(blockId: string): CodeRunSession | null {
    return this.sessions.get(blockId) ?? null;
  }

  start(blockId: string, language: RunnableLanguage, stop: () => void): void {
    this.sessions.set(blockId, {
      blockId,
      language,
      items: [],
      dropped: 0,
      running: true,
      startedAt: Date.now(),
      result: null,
      stop,
    });
    this.emit(blockId);
  }

  appendItem(blockId: string, item: CodeRunItem): void {
    this.appendItems(blockId, [item]);
  }

  /** Append a coalesced batch of items with a single notify. */
  appendItems(blockId: string, items: CodeRunItem[]): void {
    const session = this.sessions.get(blockId);
    if (!session || items.length === 0) {
      return;
    }
    for (const item of items) {
      session.items.push(item);
    }
    const overflow = session.items.length - MAX_ITEMS;
    if (overflow > 0) {
      session.items.splice(0, overflow);
      session.dropped += overflow;
    }
    this.scheduleEmit(blockId);
  }

  /** Mark the run finished; the session and its output stay until the block is disposed. */
  finish(blockId: string, result: CodeRunResult): void {
    const session = this.sessions.get(blockId);
    if (!session) {
      return;
    }
    session.running = false;
    session.result = result;
    this.emit(blockId);
  }

  remove(blockId: string): void {
    if (this.sessions.delete(blockId)) {
      this.emit(blockId);
    }
  }

  private emit(blockId: string): void {
    this.version += 1;
    this.versions.set(blockId, this.version);
    for (const listener of this.listeners) {
      listener();
    }
  }

  private scheduleEmit(blockId: string): void {
    this.pendingBlockIds.add(blockId);
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      this.version += 1;
      for (const id of this.pendingBlockIds) {
        this.versions.set(id, this.version);
      }
      this.pendingBlockIds.clear();
      for (const listener of this.listeners) {
        listener();
      }
    }, OUTPUT_FLUSH_MS);
  }
}

export const codeRunStore = new CodeRunStore();
