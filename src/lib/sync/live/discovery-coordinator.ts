import { Logger } from '@/lib/logger';
import { createEphemeralPeerId } from '../identity';
import type { VFSNodeId } from '../types';
import {
  createLivePeerDiscoveryRecord,
  isLivePeerDiscoveryRecordFresh,
  LIVE_PEER_DISCOVERY_TTL_MS,
  type LiveDiscoveryMailbox,
  type LivePeerDiscoveryRecord,
} from './discovery';
import type { PeerSnapshot } from './peer-state';
import type { Transport } from './transport';

const DEFAULT_DISCOVERY_POLL_INTERVAL_MS = 5_000;
const DEFAULT_FAILED_TICKET_RETRY_MS = 30_000;

type Timer = number | NodeJS.Timeout;

export interface LiveDiscoveryTransport extends Transport {
  host(): Promise<string>;
  join(ticket: string): Promise<void>;
}

export interface LiveDiscoverySession {
  readonly id: VFSNodeId;
  getPeerSnapshot(): PeerSnapshot;
  setTransport(transport: Transport): void;
  clearTransport(): void;
}

export interface LivePeerDiscoveryCoordinatorOptions {
  session: LiveDiscoverySession;
  mailbox: LiveDiscoveryMailbox;
  createTransport(noteId: VFSNodeId): LiveDiscoveryTransport;
  now?: () => number;
  pollIntervalMs?: number;
  recordTtlMs?: number;
  failedTicketRetryMs?: number;
  recordId?: string;
}

const logger = new Logger('LivePeerDiscovery');

export class LivePeerDiscoveryCoordinator {
  private readonly session: LiveDiscoverySession;
  private readonly mailbox: LiveDiscoveryMailbox;
  private readonly createTransport: (
    noteId: VFSNodeId,
  ) => LiveDiscoveryTransport;
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly recordTtlMs: number;
  private readonly failedTicketRetryMs: number;
  private readonly localRecordId: string;
  private readonly localPeerId: string;
  private transport: LiveDiscoveryTransport | null = null;
  private ticket: string | null = null;
  private timer: Timer | null = null;
  private lastPublishedAt: number | null = null;
  private stopped = true;
  private started = false;
  private cycleInFlight: Promise<void> | null = null;
  private readonly failedTickets = new Map<string, number>();

  constructor(options: LivePeerDiscoveryCoordinatorOptions) {
    this.session = options.session;
    this.mailbox = options.mailbox;
    this.createTransport = options.createTransport;
    this.now = options.now ?? (() => Date.now());
    this.pollIntervalMs =
      options.pollIntervalMs ?? DEFAULT_DISCOVERY_POLL_INTERVAL_MS;
    this.recordTtlMs = options.recordTtlMs ?? LIVE_PEER_DISCOVERY_TTL_MS;
    this.failedTicketRetryMs =
      options.failedTicketRetryMs ?? DEFAULT_FAILED_TICKET_RETRY_MS;
    this.localRecordId = options.recordId ?? createEphemeralPeerId();
    this.localPeerId = options.session.getPeerSnapshot().localPeerId;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    this.stopped = false;
    const transport = this.createTransport(this.session.id);
    this.transport = transport;
    transport.on('disconnected', this.onTransportDisconnected);
    this.session.setTransport(transport);

    try {
      const ticket = await transport.host();
      if (this.stopped || this.transport !== transport) {
        return;
      }

      this.ticket = ticket;
      await this.runCycle();
      this.scheduleNextCycle();
    } catch (error) {
      logger.error('Failed to start live peer discovery', error, {
        noteId: this.session.id,
      });
      await this.stop();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.started = false;
    this.clearTimer();

    const inFlight = this.cycleInFlight;
    const transport = this.transport;
    this.transport = null;
    this.ticket = null;
    this.lastPublishedAt = null;
    transport?.off('disconnected', this.onTransportDisconnected);
    this.session.clearTransport();

    await inFlight?.catch(() => {});

    await Promise.allSettled([
      this.mailbox.remove(this.session.id, this.localRecordId),
      transport?.destroy(),
    ]);
  }

  async pollNow(): Promise<void> {
    await this.runCycle();
  }

  private onTransportDisconnected = () => {
    if (this.stopped) {
      return;
    }

    void this.restart().catch((error) => {
      logger.error('Failed to restart live peer discovery', error, {
        noteId: this.session.id,
      });
    });
  };

  private async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async runCycle(): Promise<void> {
    if (this.cycleInFlight) {
      return this.cycleInFlight;
    }

    this.cycleInFlight = this.runCycleInternal().finally(() => {
      this.cycleInFlight = null;
    });
    return this.cycleInFlight;
  }

  private async runCycleInternal(): Promise<void> {
    const transport = this.transport;
    const ticket = this.ticket;
    if (this.stopped || !transport || !ticket) {
      return;
    }

    const now = this.now();
    const published = await this.publishLocalRecord(now, ticket);

    if (this.stopped || this.transport !== transport) {
      return;
    }

    if (published) {
      await this.cleanupExpiredRecords();
    }

    if (this.stopped || this.transport !== transport) {
      return;
    }

    if (transport.connected) {
      return;
    }

    let records: LivePeerDiscoveryRecord[] = [];
    try {
      records = await this.mailbox.list(this.session.id);
    } catch (error) {
      logger.warn('Failed to list live discovery records', error, {
        noteId: this.session.id,
      });
      return;
    }

    if (this.stopped || this.transport !== transport) {
      return;
    }

    for (const record of records) {
      if (
        record.recordId === this.localRecordId ||
        record.ticket === ticket ||
        record.noteId !== this.session.id ||
        !isLivePeerDiscoveryRecordFresh(record, now)
      ) {
        continue;
      }

      const failedKey = `${record.peerId}\0${record.ticket}`;
      const lastFailedAt = this.failedTickets.get(failedKey);
      if (
        lastFailedAt !== undefined &&
        now - lastFailedAt < this.failedTicketRetryMs
      ) {
        continue;
      }

      try {
        await transport.join(record.ticket);
        return;
      } catch (error) {
        this.failedTickets.set(failedKey, now);
        logger.warn('Failed to join discovered peer', error, {
          noteId: this.session.id,
          peerId: record.peerId,
        });
      }
    }
  }

  private scheduleNextCycle(): void {
    if (this.stopped || this.timer !== null) {
      return;
    }

    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      void this.runCycle()
        .catch((error) => {
          logger.warn('Live peer discovery poll failed', error, {
            noteId: this.session.id,
          });
        })
        .finally(() => this.scheduleNextCycle());
    }, this.pollIntervalMs);
  }

  private clearTimer(): void {
    if (this.timer === null) {
      return;
    }

    globalThis.clearTimeout(this.timer);
    this.timer = null;
  }

  private async publishLocalRecord(
    now: number,
    ticket: string,
  ): Promise<boolean> {
    const refreshIntervalMs = Math.max(1, Math.floor(this.recordTtlMs / 2));
    if (
      this.lastPublishedAt !== null &&
      now - this.lastPublishedAt < refreshIntervalMs
    ) {
      return false;
    }

    try {
      await this.mailbox.publish(
        createLivePeerDiscoveryRecord({
          recordId: this.localRecordId,
          noteId: this.session.id,
          peerId: this.localPeerId,
          ticket,
          now,
          ttlMs: this.recordTtlMs,
        }),
      );
      this.lastPublishedAt = now;
      return true;
    } catch (error) {
      logger.warn('Failed to publish live discovery record', error, {
        noteId: this.session.id,
      });
      return false;
    }
  }

  private async cleanupExpiredRecords(): Promise<void> {
    try {
      await this.mailbox.cleanupExpired(this.session.id, {
        excludeRecordIds: [this.localRecordId],
      });
    } catch (error) {
      logger.warn('Failed to clean up expired live discovery records', error, {
        noteId: this.session.id,
      });
    }
  }
}
