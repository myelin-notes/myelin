import { fetch } from '@tauri-apps/plugin-http';
import {
  type LiveDiscoveryClient,
  type LiveDiscoveryRecord,
  type LiveDiscoveryRecordInput,
  parseLiveDiscoveryRecords,
} from './discovery';

interface CloudflareLiveDiscoveryClientOptions {
  baseUrl: string;
  roomId: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export class CloudflareLiveDiscoveryClient implements LiveDiscoveryClient {
  private readonly baseUrl: string;
  private readonly roomId: string;
  // Returned by the first publish of a record; required to refresh or remove it.
  private readonly tokens = new Map<string, string>();

  constructor(options: CloudflareLiveDiscoveryClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.roomId = options.roomId;
  }

  async publish(
    record: LiveDiscoveryRecordInput,
  ): Promise<LiveDiscoveryRecord[]> {
    const response = await this.request(
      this.recordsUrl(),
      { method: 'POST', body: JSON.stringify(record) },
      this.tokens.get(record.recordId),
    );
    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token === 'string') {
      this.tokens.set(record.recordId, body.token);
    }
    return parseLiveDiscoveryRecords(body);
  }

  async list(): Promise<LiveDiscoveryRecord[]> {
    const response = await this.request(this.recordsUrl(), {
      method: 'GET',
    });
    return parseLiveDiscoveryRecords(await response.json());
  }

  async remove(recordId: string): Promise<void> {
    await this.request(
      `${this.recordsUrl()}/${encodeURIComponent(recordId)}`,
      { method: 'DELETE' },
      this.tokens.get(recordId),
    );
    this.tokens.delete(recordId);
  }

  private recordsUrl(): string {
    return `${this.baseUrl}/v1/rooms/${encodeURIComponent(this.roomId)}/records`;
  }

  private async request(
    url: string,
    init: { method: 'GET' | 'POST' | 'DELETE'; body?: string },
    token?: string,
  ): Promise<Response> {
    const response = await fetch(url, {
      method: init.method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { 'X-Record-Token': token } : {}),
      },
      body: init.body,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '<no response body>');
      throw new Error(
        `Live discovery request failed (${response.status}): ${body}`,
      );
    }

    return response;
  }
}
