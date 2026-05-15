import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IrohTransport } from './iroh';

type TauriEventHandler = (event: { payload: unknown }) => void;

const tauri = vi.hoisted(() => {
  const listeners = new Map<string, Set<TauriEventHandler>>();

  return {
    listeners,
    invoke: vi.fn(),
    listen: vi.fn(async (eventName: string, handler: TauriEventHandler) => {
      let handlers = listeners.get(eventName);
      if (!handlers) {
        handlers = new Set();
        listeners.set(eventName, handlers);
      }
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }),
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
  invoke: tauri.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauri.listen,
}));

function emit(eventName: string, payload: unknown): void {
  for (const handler of tauri.listeners.get(eventName) ?? []) {
    handler({ payload });
  }
}

function getHostedTransportId(): string {
  const hostCall = tauri.invoke.mock.calls.find(([command]) => {
    return command === 'iroh_host';
  });
  const payload = hostCall?.[1];
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('transportId' in payload) ||
    typeof payload.transportId !== 'string'
  ) {
    throw new Error('Expected iroh_host to receive a transport id.');
  }
  return payload.transportId;
}

describe('IrohTransport', () => {
  beforeEach(() => {
    tauri.listeners.clear();
    tauri.listen.mockClear();
    tauri.invoke.mockReset();
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === 'iroh_host') {
        return 'local-node';
      }
      return undefined;
    });
  });

  it('marks the passive side connected before delivering a received payload', async () => {
    const transport = new IrohTransport('note-1');
    const events: string[] = [];

    transport.on('connected', () => {
      events.push('connected');
    });
    transport.on('message', (data) => {
      events.push(`message:${Array.from(data).join(',')}`);
    });

    await transport.host();
    expect(transport.connected).toBe(false);

    emit('iroh-message', {
      noteId: 'note-1',
      transportId: getHostedTransportId(),
      data: [1, 2, 3],
    });

    expect(transport.connected).toBe(true);
    expect(events).toEqual(['connected', 'message:1,2,3']);
  });
});
