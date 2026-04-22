import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Logger } from '@/lib/logger';
import type { Transport, TransportEvents } from './transport';

type EventName = keyof TransportEvents;

interface NoteTransportPayload {
  noteId: string;
  transportId: string;
}

interface MessagePayload extends NoteTransportPayload {
  data: number[];
}

interface ConnectedPayload extends NoteTransportPayload {
  peerId: string;
}

interface ErrorPayload extends NoteTransportPayload {
  message: string;
}

function createTransportId(): string {
  // Use globalThis so the fallback works in both the Tauri webview and the
  // Node-based test environment without assuming a window global.
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

const logger = new Logger('IrohTransport');

export class IrohTransport implements Transport {
  private readonly transportId = createTransportId();
  private _connected = false;
  private unlisteners: UnlistenFn[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: generic event emitter
  private listeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(private readonly noteId: string) {}

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
    await invoke('iroh_send', {
      noteId: this.noteId,
      transportId: this.transportId,
      data: Array.from(data),
    });
  }

  async host(): Promise<string> {
    await this.setupTauriListeners();
    const ticket = await invoke<string>('iroh_host', {
      noteId: this.noteId,
      transportId: this.transportId,
    });
    logger.debug('Hosting note transport', { noteId: this.noteId });
    return ticket;
  }

  async join(ticket: string): Promise<void> {
    await this.setupTauriListeners();
    await invoke('iroh_join', {
      noteId: this.noteId,
      transportId: this.transportId,
      ticket,
    });
    logger.debug('Joining note transport', { noteId: this.noteId });
  }

  async destroy(): Promise<void> {
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];
    this._connected = false;
    await invoke('iroh_leave', {
      noteId: this.noteId,
      transportId: this.transportId,
    }).catch(() => {});
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

  private matches(payload: NoteTransportPayload): boolean {
    return (
      payload.noteId === this.noteId && payload.transportId === this.transportId
    );
  }

  private async setupTauriListeners(): Promise<void> {
    if (this.unlisteners.length > 0) {
      return;
    }

    const onMessage = await listen<MessagePayload>('iroh-message', (event) => {
      if (!this.matches(event.payload)) {
        return;
      }

      const data = new Uint8Array(event.payload.data);
      logger.debug('Received transport payload', {
        noteId: this.noteId,
        byteLength: data.byteLength,
      });
      this.emit('message', data);
    });

    const onConnected = await listen<ConnectedPayload>(
      'iroh-connected',
      (event) => {
        if (!this.matches(event.payload)) {
          return;
        }

        logger.debug('Connected to peer', {
          noteId: this.noteId,
          peerId: event.payload.peerId,
        });
        this._connected = true;
        this.emit('connected');
      },
    );

    const onDisconnected = await listen<NoteTransportPayload>(
      'iroh-disconnected',
      (event) => {
        if (!this.matches(event.payload)) {
          return;
        }

        logger.debug('Disconnected transport', { noteId: this.noteId });
        this._connected = false;
        this.emit('disconnected');
      },
    );

    const onError = await listen<ErrorPayload>('iroh-error', (event) => {
      if (!this.matches(event.payload)) {
        return;
      }

      logger.error('Transport error', {
        noteId: this.noteId,
        message: event.payload.message,
      });
    });

    this.unlisteners = [onMessage, onConnected, onDisconnected, onError];
  }
}
