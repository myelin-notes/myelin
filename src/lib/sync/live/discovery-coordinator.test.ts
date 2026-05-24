import { describe, expect, it, vi } from 'vitest';
import type {
  LiveDiscoveryClient,
  LiveDiscoveryRecord,
  LiveDiscoveryRecordInput,
} from './discovery';
import {
  type LiveDiscoverySession,
  type LiveDiscoveryTransport,
  LivePeerDiscoveryCoordinator,
} from './discovery-coordinator';
import type { TransportEvents } from './transport';

type EventName = keyof TransportEvents;

class FakeClient implements LiveDiscoveryClient {
  records: LiveDiscoveryRecord[] = [];
  publish = vi.fn(async (record: LiveDiscoveryRecordInput) => {
    const now = 1_000;
    this.records = [
      ...this.records.filter((entry) => entry.recordId !== record.recordId),
      {
        recordId: record.recordId,
        peerId: record.peerId,
        ticket: record.ticket,
        updatedAt: now,
        expiresAt: now + record.ttlMs,
      },
    ];
    return this.records;
  });
  list = vi.fn(async () => this.records);
  remove = vi.fn(async (recordId: string) => {
    this.records = this.records.filter(
      (record) => record.recordId !== recordId,
    );
  });
}

class FakeTransport implements LiveDiscoveryTransport {
  connected = false;
  readonly failedTickets = new Set<string>();
  private readonly listeners = new Map<
    string,
    Set<(...args: unknown[]) => void>
  >();

  constructor(private readonly hostTicket: string) {}

  host = vi.fn(async () => this.hostTicket);
  join = vi.fn(async (ticket: string) => {
    if (this.failedTickets.has(ticket)) {
      throw new Error('join failed');
    }

    this.connected = true;
    this.emit('connected');
  });
  send = vi.fn(async () => {});
  destroy = vi.fn(async () => {
    this.connected = false;
  });

  on<E extends EventName>(event: E, handler: TransportEvents[E]): void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(handler as (...args: unknown[]) => void);
  }

  off<E extends EventName>(event: E, handler: TransportEvents[E]): void {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  emit(event: EventName): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler();
    }
  }

  emitError(error: Error): void {
    for (const handler of this.listeners.get('error') ?? []) {
      handler(error);
    }
  }
}

function createSession(): LiveDiscoverySession & {
  transport: LiveDiscoveryTransport | null;
  setTransport: ReturnType<typeof vi.fn>;
  clearTransport: ReturnType<typeof vi.fn>;
} {
  return {
    id: 'note-1',
    localPeerId: 'peer-local',
    transport: null,
    setTransport: vi.fn(function (
      this: { transport: LiveDiscoveryTransport | null },
      transport: LiveDiscoveryTransport,
    ) {
      this.transport = transport;
    }),
    clearTransport: vi.fn(function (this: {
      transport: LiveDiscoveryTransport | null;
    }) {
      this.transport = null;
    }),
  };
}

function remoteRecord(ticket: string): LiveDiscoveryRecord {
  return {
    recordId: `record-${ticket}`,
    peerId: `peer-${ticket}`,
    ticket,
    updatedAt: 1_000,
    expiresAt: 10_000,
  };
}

async function nextTick(): Promise<void> {
  await Promise.resolve();
}

async function waitForMicrotaskCondition(
  condition: () => boolean,
): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    if (condition()) {
      return;
    }

    await nextTick();
  }
}

describe('LivePeerDiscoveryCoordinator', () => {
  it('publishes the local ticket and joins a discovered peer', async () => {
    const session = createSession();
    const client = new FakeClient();
    const transport = new FakeTransport('local-ticket');
    client.records = [remoteRecord('remote-ticket')];
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      client,
      createTransport: () => transport,
      recordId: 'record-local',
      now: () => 1_000,
    });

    await coordinator.start();

    expect(session.setTransport).toHaveBeenCalledWith(transport);
    expect(transport.host).toHaveBeenCalledTimes(1);
    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'record-local',
        peerId: 'peer-local',
        ticket: 'local-ticket',
      }),
    );
    expect(transport.join).toHaveBeenCalledWith('remote-ticket');

    await coordinator.stop();
  });

  it('polls after start while disconnected', async () => {
    const session = createSession();
    const client = new FakeClient();
    const transport = new FakeTransport('local-ticket');
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      client,
      createTransport: () => transport,
      recordId: 'record-local',
      now: () => 1_000,
    });

    await coordinator.start();
    client.records = [...client.records, remoteRecord('remote-ticket')];
    await coordinator.pollNow();

    expect(client.list).toHaveBeenCalledTimes(1);
    expect(transport.join).toHaveBeenCalledWith('remote-ticket');

    await coordinator.stop();
  });

  it('marks live sync paused when discovery polling fails and active after recovery', async () => {
    const session = createSession();
    const client = new FakeClient();
    const transport = new FakeTransport('local-ticket');
    const networkError = new Error('network down');
    const pauseErrors: Array<Error | null> = [];
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      client,
      createTransport: () => transport,
      onPauseChange: (error) => pauseErrors.push(error),
      recordId: 'record-local',
      now: () => 1_000,
    });

    await coordinator.start();
    client.list.mockRejectedValueOnce(networkError);

    await expect(coordinator.pollNow()).rejects.toThrow('network down');
    expect(pauseErrors).toContain(networkError);

    await coordinator.pollNow();
    expect(pauseErrors[pauseErrors.length - 1]).toBeNull();

    await coordinator.stop();
  });

  it('restarts when the transport reports an error', async () => {
    const session = createSession();
    const client = new FakeClient();
    const transports: FakeTransport[] = [];
    const transportError = new Error(
      'Iroh gossip receiver lagged; reconnect to resume live sync.',
    );
    const pauseErrors: Array<Error | null> = [];
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      client,
      createTransport: () => {
        const transport = new FakeTransport(
          `local-ticket-${transports.length}`,
        );
        transports.push(transport);
        return transport;
      },
      onPauseChange: (error) => pauseErrors.push(error),
      recordId: 'record-local',
      now: () => 1_000,
    });

    await coordinator.start();
    const firstTransport = transports[0];
    firstTransport.emitError(transportError);
    await waitForMicrotaskCondition(() => transports.length === 2);

    expect(pauseErrors).toContain(transportError);
    expect(firstTransport.destroy).toHaveBeenCalledTimes(1);
    expect(transports).toHaveLength(2);

    await coordinator.stop();
  });

  it('does not retry a failed ticket inside the retry window', async () => {
    const session = createSession();
    const client = new FakeClient();
    const transport = new FakeTransport('local-ticket');
    transport.failedTickets.add('bad-ticket');
    client.records = [remoteRecord('bad-ticket')];
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      client,
      createTransport: () => transport,
      recordId: 'record-local',
      joinRetryMs: 30_000,
      now: () => 1_000,
    });

    await coordinator.start();
    await coordinator.pollNow();

    expect(transport.join).toHaveBeenCalledTimes(1);

    await coordinator.stop();
  });

  it('removes the local record and destroys the transport on stop', async () => {
    const session = createSession();
    const client = new FakeClient();
    const transport = new FakeTransport('local-ticket');
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      client,
      createTransport: () => transport,
      recordId: 'record-local',
    });

    await coordinator.start();
    await coordinator.stop();

    expect(client.remove).toHaveBeenCalledWith('record-local');
    expect(transport.destroy).toHaveBeenCalledTimes(1);
    expect(session.clearTransport).toHaveBeenCalled();
  });

  it('refreshes the published record near the TTL', async () => {
    vi.useFakeTimers();
    try {
      const session = createSession();
      const client = new FakeClient();
      const transport = new FakeTransport('local-ticket');
      const coordinator = new LivePeerDiscoveryCoordinator({
        session,
        client,
        createTransport: () => transport,
        initialPollIntervalMs: 60_000,
        recordId: 'record-local',
        recordTtlMs: 10_000,
      });

      await coordinator.start();

      expect(client.publish).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(8_999);
      expect(client.publish).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(client.publish).toHaveBeenCalledTimes(2);

      await coordinator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not restart after stop interrupts a disconnect restart', async () => {
    const session = createSession();
    const client = new FakeClient();
    const removeResolvers: Array<() => void> = [];
    client.remove.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          removeResolvers.push(resolve);
        }),
    );
    const transports: FakeTransport[] = [];
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      client,
      createTransport: () => {
        const transport = new FakeTransport(
          `local-ticket-${transports.length}`,
        );
        transports.push(transport);
        return transport;
      },
      recordId: 'record-local',
    });

    await coordinator.start();
    transports[0].emit('disconnected');
    await waitForMicrotaskCondition(() => removeResolvers.length === 1);
    expect(removeResolvers).toHaveLength(1);

    const stopPromise = coordinator.stop();
    await nextTick();
    expect(removeResolvers).toHaveLength(2);

    for (const resolve of removeResolvers) {
      resolve();
    }
    await stopPromise;
    await nextTick();

    expect(transports).toHaveLength(1);
  });

  it('runs overlapping cycles sequentially', async () => {
    const session = createSession();
    const client = new FakeClient();
    const transport = new FakeTransport('local-ticket');
    const listResolvers: Array<() => void> = [];
    client.list.mockImplementation(
      () =>
        new Promise<LiveDiscoveryRecord[]>((resolve) => {
          listResolvers.push(() => resolve(client.records));
        }),
    );
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      client,
      createTransport: () => transport,
      recordId: 'record-local',
    });

    await coordinator.start();
    const firstPoll = coordinator.pollNow();
    const secondPoll = coordinator.pollNow();
    await nextTick();
    expect(listResolvers).toHaveLength(1);

    listResolvers[0]();
    await waitForMicrotaskCondition(() => listResolvers.length === 2);
    expect(listResolvers).toHaveLength(2);

    listResolvers[1]();
    await Promise.all([firstPoll, secondPoll]);

    expect(client.list).toHaveBeenCalledTimes(2);

    await coordinator.stop();
  });
});
