import { Logger } from '@/lib/logger';
import type { VFSNodeId } from '../types';
import {
  createLiveDiscoveryRecordInput,
  LIVE_DISCOVERY_RECORD_TTL_MS,
  type LiveDiscoveryClient,
  type LiveDiscoveryRecord,
} from './discovery';
import type { Transport } from './transport';

const INITIAL_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 60_000;
const JOIN_RETRY_MS = 30_000;

type Timer = number | NodeJS.Timeout;

export interface LiveDiscoveryTransport extends Transport {
  host(): Promise<string>;
  join(ticket: string): Promise<void>;
}

export interface LiveDiscoverySession {
  readonly id: VFSNodeId;
  readonly localPeerId: string;
  setTransport(transport: Transport): void;
  clearTransport(): void;
}

export interface LivePeerDiscoveryCoordinatorOptions {
  session: LiveDiscoverySession;
  client: LiveDiscoveryClient;
  createTransport(noteId: VFSNodeId): LiveDiscoveryTransport;
  now?: () => number;
  recordId?: string;
  recordTtlMs?: number;
  initialPollIntervalMs?: number;
  maxPollIntervalMs?: number;
  joinRetryMs?: number;
}

const logger = new Logger('LivePeerDiscovery');

function createRecordId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export class LivePeerDiscoveryCoordinator {
  private readonly session: LiveDiscoverySession;
  private readonly client: LiveDiscoveryClient;
  private readonly createTransport: (
    noteId: VFSNodeId,
  ) => LiveDiscoveryTransport;
  private readonly now: () => number;
  private readonly recordId: string;
  private readonly recordTtlMs: number;
  private readonly initialPollIntervalMs: number;
  private readonly maxPollIntervalMs: number;
  private readonly joinRetryMs: number;
  private transport: LiveDiscoveryTransport | null = null;
  private ticket: string | null = null;
  private pollTimer: Timer | null = null;
  private refreshTimer: Timer | null = null;
  private stopped = true;
  private started = false;
  private cycleInFlight: Promise<void> | null = null;
  private currentPollIntervalMs: number;
  private readonly recentJoinAttempts = new Map<string, number>();

  constructor(options: LivePeerDiscoveryCoordinatorOptions) {
    this.session = options.session;
    this.client = options.client;
    this.createTransport = options.createTransport;
    this.now = options.now ?? (() => Date.now());
    this.recordId = options.recordId ?? createRecordId();
    this.recordTtlMs = options.recordTtlMs ?? LIVE_DISCOVERY_RECORD_TTL_MS;
    this.initialPollIntervalMs =
      options.initialPollIntervalMs ?? INITIAL_POLL_INTERVAL_MS;
    this.maxPollIntervalMs = options.maxPollIntervalMs ?? MAX_POLL_INTERVAL_MS;
    this.joinRetryMs = options.joinRetryMs ?? JOIN_RETRY_MS;
    this.currentPollIntervalMs = this.initialPollIntervalMs;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    this.stopped = false;
    this.currentPollIntervalMs = this.initialPollIntervalMs;

    const transport = this.createTransport(this.session.id);
    this.transport = transport;
    transport.on('connected', this.onTransportConnected);
    transport.on('disconnected', this.onTransportDisconnected);
    this.session.setTransport(transport);

    try {
      const ticket = await transport.host();
      if (this.stopped || this.transport !== transport) {
        return;
      }

      this.ticket = ticket;
      await this.publishAndTryJoin();
      this.scheduleRefresh();
      this.schedulePoll();
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
    this.clearPollTimer();
    this.clearRefreshTimer();

    const inFlight = this.cycleInFlight;
    const transport = this.transport;
    this.transport = null;
    this.ticket = null;

    transport?.off('connected', this.onTransportConnected);
    transport?.off('disconnected', this.onTransportDisconnected);
    this.session.clearTransport();

    await inFlight?.catch(() => {});

    await Promise.allSettled([
      this.client.remove(this.recordId),
      transport?.destroy(),
    ]);
  }

  async pollNow(): Promise<void> {
    await this.runCycle(async () => {
      const records = await this.client.list();
      await this.tryJoin(records);
    });
  }

  private onTransportConnected = () => {
    this.clearPollTimer();
  };

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

  private async publishAndTryJoin(): Promise<void> {
    await this.runCycle(async () => {
      const ticket = this.ticket;
      if (!ticket) {
        return;
      }

      const records = await this.client.publish(
        createLiveDiscoveryRecordInput({
          recordId: this.recordId,
          peerId: this.session.localPeerId,
          ticket,
          ttlMs: this.recordTtlMs,
        }),
      );
      await this.tryJoin(records);
    });
  }

  private async runCycle(action: () => Promise<void>): Promise<void> {
    if (this.cycleInFlight) {
      return this.cycleInFlight;
    }

    this.cycleInFlight = action().finally(() => {
      this.cycleInFlight = null;
    });
    return this.cycleInFlight;
  }

  private async tryJoin(records: LiveDiscoveryRecord[]): Promise<void> {
    const transport = this.transport;
    const ticket = this.ticket;
    if (this.stopped || !transport || !ticket || transport.connected) {
      return;
    }

    const now = this.now();
    for (const record of records) {
      if (
        record.recordId === this.recordId ||
        record.peerId === this.session.localPeerId ||
        record.ticket === ticket ||
        record.expiresAt <= now
      ) {
        continue;
      }

      const lastAttemptAt = this.recentJoinAttempts.get(record.ticket);
      if (
        lastAttemptAt !== undefined &&
        now - lastAttemptAt < this.joinRetryMs
      ) {
        continue;
      }

      try {
        this.recentJoinAttempts.set(record.ticket, now);
        await transport.join(record.ticket);
        return;
      } catch (error) {
        logger.warn('Failed to join discovered live peer', error, {
          noteId: this.session.id,
          peerId: record.peerId,
        });
      }
    }
  }

  private schedulePoll(): void {
    if (
      this.stopped ||
      this.pollTimer !== null ||
      this.transport?.connected === true
    ) {
      return;
    }

    this.pollTimer = globalThis.setTimeout(() => {
      this.pollTimer = null;
      void this.pollNow()
        .catch((error) => {
          logger.warn('Live peer discovery poll failed', error, {
            noteId: this.session.id,
          });
        })
        .finally(() => {
          this.currentPollIntervalMs = Math.min(
            this.currentPollIntervalMs * 2,
            this.maxPollIntervalMs,
          );
          this.schedulePoll();
        });
    }, this.currentPollIntervalMs);
  }

  private scheduleRefresh(): void {
    if (this.stopped || this.refreshTimer !== null) {
      return;
    }

    const refreshIntervalMs = Math.max(1_000, Math.floor(this.recordTtlMs / 2));
    this.refreshTimer = globalThis.setTimeout(() => {
      this.refreshTimer = null;
      void this.publishAndTryJoin()
        .catch((error) => {
          logger.warn('Live peer discovery refresh failed', error, {
            noteId: this.session.id,
          });
        })
        .finally(() => this.scheduleRefresh());
    }, refreshIntervalMs);
  }

  private clearPollTimer(): void {
    if (this.pollTimer === null) {
      return;
    }

    globalThis.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer === null) {
      return;
    }

    globalThis.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}
