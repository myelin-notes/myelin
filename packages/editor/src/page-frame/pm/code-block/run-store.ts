import type { RunnableLanguage } from '../../../code-runner/contract';

export interface CodeRunLine {
  text: string;
  stream: 'stdout' | 'stderr';
}

/** Live state of one in-flight (or just-finished, pre-settle) run, keyed by the block's stable id. */
export interface CodeRunSession {
  blockId: string;
  language: RunnableLanguage;
  lines: CodeRunLine[];
  running: boolean;
  startedAt: number;
  /** Cancels the run; wired by the owning run button so the output card's stop button works. */
  stop: () => void;
}

// The card re-render is O(line count) (the virtualizer rebuilds its offsets), so pacing well
// below the display refresh rate keeps a flood of output from saturating the main thread — ~15 Hz
// still reads as continuous streaming.
const OUTPUT_FLUSH_MS = 64;

// Bridges the vanilla code-block run buttons to the React output cards on the canvas. Run views
// push live output here; CodeOutputCardView subscribes per block id.
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
      lines: [],
      running: true,
      startedAt: Date.now(),
      stop,
    });
    this.emit(blockId);
  }

  appendLine(blockId: string, line: CodeRunLine): void {
    const session = this.sessions.get(blockId);
    if (!session) {
      return;
    }
    session.lines.push(line);
    this.scheduleEmit(blockId);
  }

  /** Append a coalesced batch of lines with a single notify. */
  appendLines(blockId: string, lines: CodeRunLine[]): void {
    const session = this.sessions.get(blockId);
    if (!session || lines.length === 0) {
      return;
    }
    for (const line of lines) {
      session.lines.push(line);
    }
    this.scheduleEmit(blockId);
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
