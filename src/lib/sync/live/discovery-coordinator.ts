import { Logger } from '@/lib/logger';
import type { VFSNodeId } from '../types';
import {
  createLivePeerDiscoveryRecord,
  isLivePeerDiscoveryRecordFresh,
  LIVE_PEER_DISCOVERY_MAX_RECORDS,
  LIVE_PEER_DISCOVERY_TTL_MS,
  type LiveDiscoveryMailbox,
  type LivePeerDiscoveryRecord,
} from './discovery';
import type { Transport } from './transport';

const DEFAULT_DISCOVERY_POLL_INTERVAL_MS = 360_000;
const DEFAULT_FAILED_TICKET_RETRY_MS = 30_000;
const MAILBOX_BUDGET_WINDOW_MS = 3_600_000;
const MAILBOX_BUDGET_UNITS_PER_HOUR = 400;
const PUBLISH_BUDGET_UNITS = 6;
const LIST_BUDGET_UNITS = 2 + LIVE_PEER_DISCOVERY_MAX_RECORDS;
const CLEANUP_BUDGET_UNITS = 2 + LIVE_PEER_DISCOVERY_MAX_RECORDS * 2;
const REMOVE_BUDGET_UNITS = 4;

type Timer = number | NodeJS.Timeout;

export interface LiveDiscoveryTransport extends Transport {
  host(): Promise<string>;
  join(ticket: string): Promise<void>;
}

export interface LiveDiscoverySession {
  readonly id: VFSNodeId;
  readonly localPeerId: string;
  setTransport(transport: Transport, options?: TransportPeerStateOptions): void;
  clearTransport(options?: TransportPeerStateOptions): void;
}

interface TransportPeerStateOptions {
  resetRemotePeers?: boolean;
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
  mailboxBudget?: LiveDiscoveryMailboxBudget;
}

export interface LiveDiscoveryMailboxBudget {
  tryConsume(units: number, now: number): boolean;
}

interface BudgetEntry {
  at: number;
  units: number;
}

export class SlidingWindowLiveDiscoveryMailboxBudget
  implements LiveDiscoveryMailboxBudget
{
  private entries: BudgetEntry[] = [];

  constructor(
    private readonly maxUnits = MAILBOX_BUDGET_UNITS_PER_HOUR,
    private readonly windowMs = MAILBOX_BUDGET_WINDOW_MS,
  ) {}

  tryConsume(units: number, now: number): boolean {
    const windowStart = now - this.windowMs;
    this.entries = this.entries.filter((entry) => entry.at >= windowStart);
    const used = this.entries.reduce((total, entry) => total + entry.units, 0);
    if (used + units > this.maxUnits) {
      return false;
    }

    this.entries.push({ at: now, units });
    return true;
  }
}

const logger = new Logger('LivePeerDiscovery');
const sharedMailboxBudget = new SlidingWindowLiveDiscoveryMailboxBudget();

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
  private readonly mailboxBudget: LiveDiscoveryMailboxBudget;
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
    this.localPeerId = options.session.localPeerId;
    this.localRecordId = options.recordId ?? this.localPeerId;
    this.mailboxBudget = options.mailboxBudget ?? sharedMailboxBudget;
  }

  async start(options: TransportPeerStateOptions = {}): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    this.stopped = false;
    const transport = this.createTransport(this.session.id);
    this.transport = transport;
    transport.on('disconnected', this.onTransportDisconnected);
    this.session.setTransport(transport, options);

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

  async stop(options: TransportPeerStateOptions = {}): Promise<void> {
    this.stopped = true;
    this.started = false;
    this.clearTimer();

    const inFlight = this.cycleInFlight;
    const transport = this.transport;
    this.transport = null;
    this.ticket = null;
    this.lastPublishedAt = null;
    transport?.off('disconnected', this.onTransportDisconnected);
    this.session.clearTransport(options);

    await inFlight?.catch(() => {});

    await Promise.allSettled([this.removeLocalRecord(), transport?.destroy()]);
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
    const options = { resetRemotePeers: false };
    await this.stop(options);
    await this.start(options);
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
    await this.publishLocalRecord(now, ticket);

    if (this.stopped || this.transport !== transport) {
      return;
    }

    if (transport.connected) {
      return;
    }

    let records: LivePeerDiscoveryRecord[] = [];
    try {
      if (!this.consumeMailboxBudget('list', LIST_BUDGET_UNITS, now)) {
        return;
      }

      records = await this.mailbox.list(this.session.id, {
        maxEntries: LIVE_PEER_DISCOVERY_MAX_RECORDS,
      });
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

    await this.cleanupExpiredRecords();
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
      if (!this.consumeMailboxBudget('publish', PUBLISH_BUDGET_UNITS, now)) {
        return false;
      }

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

  private async removeLocalRecord(): Promise<void> {
    if (!this.consumeMailboxBudget('remove', REMOVE_BUDGET_UNITS, this.now())) {
      return;
    }

    try {
      await this.mailbox.remove(this.session.id, this.localRecordId);
    } catch (error) {
      logger.warn('Failed to remove live discovery record', error, {
        noteId: this.session.id,
      });
    }
  }

  private async cleanupExpiredRecords(): Promise<void> {
    if (
      !this.consumeMailboxBudget('cleanup', CLEANUP_BUDGET_UNITS, this.now())
    ) {
      return;
    }

    try {
      await this.mailbox.cleanupExpired(this.session.id, {
        excludeRecordIds: [this.localRecordId],
        maxEntries: LIVE_PEER_DISCOVERY_MAX_RECORDS,
      });
    } catch (error) {
      logger.warn('Failed to clean up expired live discovery records', error, {
        noteId: this.session.id,
      });
    }
  }

  private consumeMailboxBudget(
    action: string,
    units: number,
    now: number,
  ): boolean {
    if (this.mailboxBudget.tryConsume(units, now)) {
      return true;
    }

    logger.warn('Skipped live discovery mailbox operation over rate budget', {
      noteId: this.session.id,
      action,
    });
    return false;
  }
}
