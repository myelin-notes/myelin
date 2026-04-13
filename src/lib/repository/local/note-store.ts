import * as Y from 'yjs';
import { YDocManager } from '@/pages/free-canvas/ydoc-manager';
import type { NoteSession, NoteSessionStatus, NoteStore } from '../types';
import type { LocalStorageBackend } from './storage-backend';

class LocalNoteSession implements NoteSession {
  public readonly status: NoteSessionStatus = {
    phase: 'idle',
    lastError: null,
    lastSyncedAt: Date.now(),
    remoteRevision: null,
  };

  private closed = false;

  constructor(
    public readonly id: string,
    public readonly ydoc: YDocManager,
    private readonly backend: LocalStorageBackend,
  ) {}

  async refresh(): Promise<void> {
    await this.runWithPhase('refreshing', async () => {
      const bytes = await this.backend.loadNoteData(this.id);
      if (bytes) {
        Y.applyUpdate(this.ydoc.doc, bytes);
      }
    });
  }

  async flush(): Promise<void> {
    await this.runWithPhase('flushing', async () => {
      await this.backend.saveNoteData(this.id, this.ydoc.encodeState());
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.status.phase = 'closed';
  }

  private async runWithPhase(
    phase: Exclude<NoteSessionStatus['phase'], 'idle' | 'closed'>,
    action: () => Promise<void>,
  ): Promise<void> {
    if (this.closed) {
      return;
    }

    this.status.phase = phase;
    try {
      await action();
      this.status.lastError = null;
      this.status.lastSyncedAt = Date.now();
      this.status.phase = 'idle';
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error : new Error(String(error));
      this.status.phase = 'idle';
      throw error;
    }
  }
}

export class LocalNoteStore implements NoteStore {
  public readonly kind = 'local-storage';
  public readonly capabilities = {
    revealOnDisk: true,
    polling: false,
    liveSync: false,
  };

  constructor(private readonly backend: LocalStorageBackend) {}

  async openSession(nodeId: string): Promise<NoteSession> {
    const bytes = await this.backend.loadNoteData(nodeId);
    const ydoc = bytes ? YDocManager.fromUpdate(bytes) : new YDocManager();
    return new LocalNoteSession(nodeId, ydoc, this.backend);
  }

  async getRevealPath(nodeId: string): Promise<string | null> {
    return this.backend.getDiskPath(nodeId);
  }
}
