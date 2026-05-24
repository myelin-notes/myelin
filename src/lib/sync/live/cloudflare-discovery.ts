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

  constructor(options: CloudflareLiveDiscoveryClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.roomId = options.roomId;
  }

  async publish(
    record: LiveDiscoveryRecordInput,
  ): Promise<LiveDiscoveryRecord[]> {
    const response = await this.request(this.recordsUrl(), {
      method: 'POST',
      body: JSON.stringify(record),
    });
    return parseLiveDiscoveryRecords(await response.json());
  }

  async list(): Promise<LiveDiscoveryRecord[]> {
    const response = await this.request(this.recordsUrl(), {
      method: 'GET',
    });
    return parseLiveDiscoveryRecords(await response.json());
  }

  async remove(recordId: string): Promise<void> {
    await this.request(`${this.recordsUrl()}/${encodeURIComponent(recordId)}`, {
      method: 'DELETE',
    });
  }

  private recordsUrl(): string {
    return `${this.baseUrl}/v1/rooms/${encodeURIComponent(this.roomId)}/records`;
  }

  private async request(
    url: string,
    init: { method: 'GET' | 'POST' | 'DELETE'; body?: string },
  ): Promise<Response> {
    const response = await fetch(url, {
      method: init.method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
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
