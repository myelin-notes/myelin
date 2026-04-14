import * as Y from 'yjs';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { DEBUG } from '@/lib/debug';
import type { YDocManager } from '@/pages/free-canvas/ydoc-manager';

export class PeerSync {
  private updateHandler: (update: Uint8Array, origin: unknown) => void;
  private unlisteners: UnlistenFn[] = [];
  private _connected = false;

  onConnect: (() => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(private readonly ydoc: YDocManager) {
    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote-peer' && this._connected) {
        invoke('peer_send', { data: Array.from(new Uint8Array(update)) }).catch(
          (err) => {
            if (DEBUG) {
              console.error('[PeerSync] send error:', err);
            }
          },
        );
      }
    };
    this.ydoc.doc.on('update', this.updateHandler);
  }

  async setupListeners(): Promise<void> {
    const onUpdate = await listen<number[]>('peer-update', (e) => {
      const update = new Uint8Array(e.payload);
      if (DEBUG) {
        console.log(`[PeerSync] received ${update.byteLength} bytes`);
      }
      Y.applyUpdate(this.ydoc.doc, update, 'remote-peer');
    });

    const onConnected = await listen<string>('peer-connected', (e) => {
      if (DEBUG) {
        console.log(`[PeerSync] connected to ${e.payload}`);
      }
      this._connected = true;
      // Send full state to new peer
      const state = Y.encodeStateAsUpdate(this.ydoc.doc);
      invoke('peer_send', { data: Array.from(new Uint8Array(state)) }).catch(
        (err) => {
          if (DEBUG) {
            console.error('[PeerSync] initial sync error:', err);
          }
        },
      );
      this.onConnect?.();
    });

    const onDisconnected = await listen('peer-disconnected', () => {
      if (DEBUG) {
        console.log('[PeerSync] disconnected');
      }
      this._connected = false;
      this.onClose?.();
    });

    this.unlisteners = [onUpdate, onConnected, onDisconnected];
  }

  async host(port: number = 9090): Promise<string> {
    await this.setupListeners();
    const addr = await invoke<string>('peer_host', { port });
    if (DEBUG) {
      console.log(`[PeerSync] hosting on ${addr}`);
    }
    return addr;
  }

  async join(addr: string): Promise<void> {
    await this.setupListeners();
    await invoke('peer_join', { addr });
    if (DEBUG) {
      console.log(`[PeerSync] joined ${addr}`);
    }
  }

  get connected(): boolean {
    return this._connected;
  }

  async destroy(): Promise<void> {
    this.ydoc.doc.off('update', this.updateHandler);
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];
    this._connected = false;
    await invoke('peer_disconnect').catch(() => {});
  }
}
