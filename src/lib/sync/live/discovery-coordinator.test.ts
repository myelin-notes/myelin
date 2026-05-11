import { describe, expect, it, vi } from 'vitest';
import {
  createLivePeerDiscoveryRecord,
  type LiveDiscoveryMailbox,
  type LivePeerDiscoveryRecord,
} from './discovery';
import {
  type LiveDiscoverySession,
  type LiveDiscoveryTransport,
  LivePeerDiscoveryCoordinator,
} from './discovery-coordinator';
import type { TransportEvents } from './transport';

type EventName = keyof TransportEvents;

class FakeMailbox implements LiveDiscoveryMailbox {
  records: LivePeerDiscoveryRecord[] = [];
  publish = vi.fn(async (record: LivePeerDiscoveryRecord) => {
    this.records = [
      ...this.records.filter(
        (entry) =>
          entry.noteId !== record.noteId || entry.recordId !== record.recordId,
      ),
      record,
    ];
  });
  list = vi.fn(async (noteId: string) =>
    this.records.filter((record) => record.noteId === noteId),
  );
  remove = vi.fn(async (noteId: string, recordId: string) => {
    this.records = this.records.filter(
      (record) => record.noteId !== noteId || record.recordId !== recordId,
    );
  });
  cleanupExpired = vi.fn(async () => {});
}

class FakeTransport implements LiveDiscoveryTransport {
  connected = false;
  readonly failedTickets = new Set<string>();
  private readonly listeners = new Map<EventName, Set<() => void>>();

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
    listeners.add(handler as () => void);
  }

  off<E extends EventName>(event: E, handler: TransportEvents[E]): void {
    this.listeners.get(event)?.delete(handler as () => void);
  }

  emit(event: EventName): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler();
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
    transport: null,
    getPeerSnapshot: () => ({
      localPeerId: 'peer-local',
      localMode: 'owner-device',
      connectedPeers: [],
      currentWriter: 'peer-local',
      isWriter: true,
    }),
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

function createRecord(params: {
  recordId?: string;
  peerId: string;
  ticket: string;
  now: number;
  expiresAt?: number;
}): LivePeerDiscoveryRecord {
  return createLivePeerDiscoveryRecord({
    recordId: params.recordId ?? `record-${params.peerId}`,
    noteId: 'note-1',
    peerId: params.peerId,
    ticket: params.ticket,
    now: params.now,
    ttlMs: (params.expiresAt ?? params.now + 30_000) - params.now,
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForRestart(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('LivePeerDiscoveryCoordinator', () => {
  it('publishes the local ticket and joins a discovered peer', async () => {
    const now = 1_000;
    const session = createSession();
    const mailbox = new FakeMailbox();
    const transport = new FakeTransport('local-ticket');
    mailbox.records = [
      createRecord({ peerId: 'peer-remote', ticket: 'remote-ticket', now }),
    ];
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      mailbox,
      createTransport: () => transport,
      now: () => now,
      recordId: 'record-local',
    });

    await coordinator.start();

    expect(transport.host).toHaveBeenCalledTimes(1);
    expect(mailbox.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: 'note-1',
        recordId: 'record-local',
        peerId: 'peer-local',
        ticket: 'local-ticket',
      }),
    );
    expect(transport.join).toHaveBeenCalledWith('remote-ticket');

    await coordinator.stop();
  });

  it('ignores self and expired records', async () => {
    const now = 1_000;
    const session = createSession();
    const mailbox = new FakeMailbox();
    const transport = new FakeTransport('local-ticket');
    mailbox.records = [
      createRecord({
        recordId: 'record-local',
        peerId: 'peer-local',
        ticket: 'self-ticket',
        now,
      }),
      createRecord({
        peerId: 'peer-expired',
        ticket: 'expired-ticket',
        now: now - 60_000,
        expiresAt: now - 1,
      }),
    ];
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      mailbox,
      createTransport: () => transport,
      now: () => now,
      recordId: 'record-local',
    });

    await coordinator.start();

    expect(transport.join).not.toHaveBeenCalled();

    await coordinator.stop();
  });

  it('does not retry the same failed ticket inside the retry window', async () => {
    const now = 1_000;
    const session = createSession();
    const mailbox = new FakeMailbox();
    const transport = new FakeTransport('local-ticket');
    transport.failedTickets.add('bad-ticket');
    mailbox.records = [
      createRecord({ peerId: 'peer-remote', ticket: 'bad-ticket', now }),
    ];
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      mailbox,
      createTransport: () => transport,
      now: () => now,
      failedTicketRetryMs: 30_000,
      recordId: 'record-local',
    });

    await coordinator.start();
    await coordinator.pollNow();

    expect(transport.join).toHaveBeenCalledTimes(1);

    await coordinator.stop();
  });

  it('removes the local record and destroys the transport on stop', async () => {
    const now = 1_000;
    const session = createSession();
    const mailbox = new FakeMailbox();
    const transport = new FakeTransport('local-ticket');
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      mailbox,
      createTransport: () => transport,
      now: () => now,
      recordId: 'record-local',
    });

    await coordinator.start();
    await coordinator.stop();

    expect(mailbox.remove).toHaveBeenCalledWith('note-1', 'record-local');
    expect(transport.destroy).toHaveBeenCalledTimes(1);
    expect(session.clearTransport).toHaveBeenCalled();
  });

  it('preserves peer state while restarting after a transient disconnect', async () => {
    const now = 1_000;
    const session = createSession();
    const mailbox = new FakeMailbox();
    const firstTransport = new FakeTransport('first-ticket');
    const secondTransport = new FakeTransport('second-ticket');
    const createTransport = vi
      .fn()
      .mockReturnValueOnce(firstTransport)
      .mockReturnValueOnce(secondTransport);
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      mailbox,
      createTransport,
      now: () => now,
      recordId: 'record-local',
    });

    await coordinator.start();
    firstTransport.emit('disconnected');
    await waitForRestart();

    expect(session.clearTransport).toHaveBeenCalledWith({
      resetRemotePeers: false,
    });
    expect(session.setTransport).toHaveBeenLastCalledWith(secondTransport, {
      resetRemotePeers: false,
    });

    await coordinator.stop();
  });

  it('cleans up expired records after publish even when already connected', async () => {
    const now = 1_000;
    const session = createSession();
    const mailbox = new FakeMailbox();
    const transport = new FakeTransport('local-ticket');
    transport.connected = true;
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      mailbox,
      createTransport: () => transport,
      now: () => now,
      recordId: 'record-local',
    });

    await coordinator.start();

    expect(mailbox.cleanupExpired).toHaveBeenCalledWith('note-1', {
      excludeRecordIds: ['record-local'],
    });
    expect(mailbox.list).not.toHaveBeenCalled();
    expect(transport.join).not.toHaveBeenCalled();

    await coordinator.stop();
  });

  it('joins a different record even when the stored peer id matches', async () => {
    const now = 1_000;
    const session = createSession();
    const mailbox = new FakeMailbox();
    const transport = new FakeTransport('local-ticket');
    mailbox.records = [
      createRecord({
        recordId: 'record-other-instance',
        peerId: 'peer-local',
        ticket: 'remote-ticket',
        now,
      }),
    ];
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      mailbox,
      createTransport: () => transport,
      now: () => now,
      recordId: 'record-local',
    });

    await coordinator.start();

    expect(transport.join).toHaveBeenCalledWith('remote-ticket');

    await coordinator.stop();
  });

  it('does not leave a local record when stopped during publish', async () => {
    const now = 1_000;
    const session = createSession();
    const mailbox = new FakeMailbox();
    const transport = new FakeTransport('local-ticket');
    const publishStarted = deferred();
    const releasePublish = deferred();
    const publish = mailbox.publish;
    mailbox.publish = vi.fn(async (record: LivePeerDiscoveryRecord) => {
      publishStarted.resolve();
      await releasePublish.promise;
      await publish(record);
    });
    const coordinator = new LivePeerDiscoveryCoordinator({
      session,
      mailbox,
      createTransport: () => transport,
      now: () => now,
      recordId: 'record-local',
    });

    const startPromise = coordinator.start();
    await publishStarted.promise;
    const stopPromise = coordinator.stop();
    releasePublish.resolve();
    await Promise.all([startPromise, stopPromise]);

    expect(mailbox.records).toEqual([]);
    expect(mailbox.remove).toHaveBeenCalledWith('note-1', 'record-local');
  });
});
