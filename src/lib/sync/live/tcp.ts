import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { DEBUG } from '@/lib/debug';
import type { Transport, TransportEvents } from './transport';

type EventName = keyof TransportEvents;

export class TcpTransport implements Transport {
  private _connected = false;
  private unlisteners: UnlistenFn[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: generic event emitter
  private listeners = new Map<string, Set<(...args: any[]) => void>>();

  get connected(): boolean {
    return this._connected;
  }

  on<E extends EventName>(event: E, handler: TransportEvents[E]): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  off<E extends EventName>(event: E, handler: TransportEvents[E]): void {
    this.listeners.get(event)?.delete(handler);
  }

  async send(data: Uint8Array): Promise<void> {
    await invoke('peer_send', { data: Array.from(data) });
  }

  async host(port: number = 9090): Promise<string> {
    await this.setupTauriListeners();
    const addr = await invoke<string>('peer_host', { port });
    if (DEBUG) {
      console.log(`[TcpTransport] hosting on ${addr}`);
    }
    return addr;
  }

  async join(addr: string): Promise<void> {
    await this.setupTauriListeners();
    await invoke('peer_join', { addr });
    if (DEBUG) {
      console.log(`[TcpTransport] joined ${addr}`);
    }
  }

  async destroy(): Promise<void> {
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];
    this._connected = false;
    await invoke('peer_disconnect').catch(() => {});
  }

  private emit<E extends EventName>(
    event: E,
    ...args: Parameters<TransportEvents[E]>
  ): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const handler of set) {
        handler(...args);
      }
    }
  }

  private async setupTauriListeners(): Promise<void> {
    const onUpdate = await listen<number[]>('peer-update', (e) => {
      const data = new Uint8Array(e.payload);
      if (DEBUG) {
        console.log(`[TcpTransport] received ${data.byteLength} bytes`);
      }
      this.emit('message', data);
    });

    const onConnected = await listen<string>('peer-connected', (e) => {
      if (DEBUG) {
        console.log(`[TcpTransport] connected to ${e.payload}`);
      }
      this._connected = true;
      this.emit('connected');
    });

    const onDisconnected = await listen('peer-disconnected', () => {
      if (DEBUG) {
        console.log('[TcpTransport] disconnected');
      }
      this._connected = false;
      this.emit('disconnected');
    });

    this.unlisteners = [onUpdate, onConnected, onDisconnected];
  }
}
