import { fetch } from '@tauri-apps/plugin-http';
import {
  isLivePeerDiscoveryRecordFresh,
  type LiveDiscoveryMailbox,
  type LivePeerDiscoveryRecord,
  parseLivePeerDiscoveryRecord,
} from '../live/discovery';
import { BaseRepository } from './base';
import { getGitHubToken } from './github-credentials';
import {
  createEmptyManifest,
  getStoredFilePath,
  MANIFEST_PATH,
  migrate,
  type VFSManifest,
} from './shared';
import type {
  FileType,
  RepositoryCapabilities,
  VFSFileNode,
  VFSNodeId,
} from './types';

interface GitHubContentsResponse {
  sha: string;
  content?: string | null;
}

interface GitHubDirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
}

interface GitHubWriteResponse {
  content: { sha: string };
}

interface GitHubRepositoryConfig {
  owner: string;
  repo: string;
  branch: string;
  credentialId: string;
}

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const LIVE_DISCOVERY_ROOT = '.myelin/live/v1/notes';
const MAX_MANIFEST_RETRIES = 4;

function pathSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_') || 'unknown';
}

function base64EncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64DecodeToBytes(content: string): Uint8Array {
  const normalized = content.replace(/\n/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class GitHubRepository extends BaseRepository {
  public readonly kind = 'github';
  public readonly capabilities: RepositoryCapabilities = {
    polling: true,
    liveSync: false,
    liveDiscovery: true,
  };
  public readonly liveDiscoveryMailbox: LiveDiscoveryMailbox;

  constructor(private readonly config: GitHubRepositoryConfig) {
    super();
    this.liveDiscoveryMailbox = {
      publish: (record) => this.publishLiveDiscoveryRecord(record),
      list: (noteId) => this.listLiveDiscoveryRecords(noteId),
      remove: (noteId, recordId) =>
        this.removeLiveDiscoveryRecord(noteId, recordId),
    };
  }

  protected manifestMaxRetries(): number {
    return MAX_MANIFEST_RETRIES;
  }

  protected isConflictError(error: unknown): boolean {
    const message = String(error);
    return (
      message.includes('(409)') ||
      message.includes(' 409 ') ||
      message.includes('(422)')
    );
  }

  protected async loadManifestImpl(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }> {
    const payload = await this.getContents(MANIFEST_PATH);
    if (!payload.bytes || payload.bytes.byteLength === 0) {
      const manifest = createEmptyManifest();
      const revision = await this.saveManifestImpl(
        manifest,
        payload.sha,
        'Initialize empty repository',
      );
      return { manifest, revision };
    }

    const text = new TextDecoder().decode(payload.bytes);
    const parsed = JSON.parse(text) as VFSManifest;
    migrate(parsed);
    return { manifest: parsed, revision: payload.sha };
  }

  protected async saveManifestImpl(
    manifest: VFSManifest,
    revision: string | null,
    action: string,
  ): Promise<string | null> {
    const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    return this.putContents(
      MANIFEST_PATH,
      bytes,
      revision,
      `${action} manifest`,
    );
  }

  protected async loadFileBytes(nodeId: VFSNodeId): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }> {
    const node = await this.getFileNode(nodeId);
    if (!node) {
      return { bytes: null, revision: null };
    }

    const payload = await this.getContents(getStoredFilePath(node));
    return { bytes: payload.bytes, revision: payload.sha };
  }

  protected async saveFileBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
    revision: string | null,
    message: string,
  ): Promise<string | null> {
    const node = await this.getFileNode(nodeId);
    if (!node) {
      return null;
    }
    return this.putContents(getStoredFilePath(node), bytes, revision, message);
  }

  protected async deleteFileBytes(
    nodeId: VFSNodeId,
    fileType?: FileType,
  ): Promise<void> {
    const node = await this.getFileNode(nodeId, fileType);
    if (!node) {
      return;
    }

    const path = getStoredFilePath(node);
    const payload = await this.getContents(path);
    if (!payload.sha) {
      return;
    }

    await this.deleteContents(path, payload.sha, `Delete file ${nodeId}`);
  }

  private async getFileNode(
    nodeId: VFSNodeId,
    fileType?: FileType,
  ): Promise<Pick<VFSFileNode, 'id' | 'fileType'> | null> {
    const { manifest } = await this.loadManifestImpl();
    const node = manifest.nodes[nodeId];
    if (node?.type === 'file') {
      return node;
    }
    return fileType ? { id: nodeId, fileType } : null;
  }

  private contentsUrl(path: string): string {
    return `${GITHUB_API_BASE}/repos/${this.config.owner}/${this.config.repo}/contents/${path}`;
  }

  private liveDiscoveryDir(noteId: VFSNodeId): string {
    return `${LIVE_DISCOVERY_ROOT}/${pathSegment(noteId)}`;
  }

  private liveDiscoveryPath(noteId: VFSNodeId, recordId: string): string {
    return `${this.liveDiscoveryDir(noteId)}/${pathSegment(recordId)}.json`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const accessToken = await getGitHubToken(this.config.credentialId);
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'myelin',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };
  }

  private async failureError(
    label: string,
    response: Response,
  ): Promise<Error> {
    const body = await response.text().catch(() => '<no response body>');
    return new Error(`${label} (${response.status}): ${body}`);
  }

  private async getContents(path: string): Promise<{
    sha: string | null;
    bytes: Uint8Array | null;
  }> {
    const url = `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.config.branch)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: await this.authHeaders(),
    });

    if (response.status === 404) {
      return { sha: null, bytes: null };
    }

    if (!response.ok) {
      throw await this.failureError('GitHub contents request failed', response);
    }

    const payload = (await response.json()) as GitHubContentsResponse;
    const bytes = payload.content ? base64DecodeToBytes(payload.content) : null;
    return { sha: payload.sha, bytes };
  }

  private async listContents(path: string): Promise<GitHubDirectoryEntry[]> {
    const url = `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.config.branch)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: await this.authHeaders(),
    });

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      throw await this.failureError('GitHub contents request failed', response);
    }

    const payload = (await response.json()) as
      | GitHubDirectoryEntry[]
      | GitHubContentsResponse;
    return Array.isArray(payload)
      ? payload.filter((entry) => entry.type === 'file')
      : [];
  }

  private async putContents(
    path: string,
    bytes: Uint8Array,
    sha: string | null,
    message: string,
  ): Promise<string> {
    const response = await fetch(this.contentsUrl(path), {
      method: 'PUT',
      headers: {
        ...(await this.authHeaders()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        content: base64EncodeBytes(bytes),
        branch: this.config.branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!response.ok) {
      throw await this.failureError('GitHub write request failed', response);
    }

    const payload = (await response.json()) as GitHubWriteResponse;
    return payload.content.sha;
  }

  private async deleteContents(
    path: string,
    sha: string,
    message: string,
  ): Promise<void> {
    const response = await fetch(this.contentsUrl(path), {
      method: 'DELETE',
      headers: {
        ...(await this.authHeaders()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, sha, branch: this.config.branch }),
    });

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw await this.failureError('GitHub delete request failed', response);
    }
  }

  private async publishLiveDiscoveryRecord(
    record: LivePeerDiscoveryRecord,
  ): Promise<void> {
    const path = this.liveDiscoveryPath(record.noteId, record.recordId);
    const existing = await this.getContents(path);
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    const message = `Update live discovery for ${record.noteId}`;
    try {
      await this.putContents(path, bytes, existing.sha, message);
    } catch (error) {
      if (!this.isConflictError(error)) {
        throw error;
      }

      const latest = await this.getContents(path);
      await this.putContents(path, bytes, latest.sha, message);
    }
  }

  private async listLiveDiscoveryRecords(
    noteId: VFSNodeId,
  ): Promise<LivePeerDiscoveryRecord[]> {
    const entries = await this.listContents(this.liveDiscoveryDir(noteId));
    const now = Date.now();
    const records = await Promise.all(
      entries.map(async (entry) => {
        try {
          const { bytes } = await this.getContents(entry.path);
          if (!bytes) {
            return null;
          }
          const parsed = parseLivePeerDiscoveryRecord(
            JSON.parse(new TextDecoder().decode(bytes)),
          );
          if (
            !parsed ||
            parsed.noteId !== noteId ||
            !isLivePeerDiscoveryRecordFresh(parsed, now)
          ) {
            return null;
          }
          return parsed;
        } catch {
          return null;
        }
      }),
    );

    return records.filter(
      (record): record is LivePeerDiscoveryRecord => record !== null,
    );
  }

  private async removeLiveDiscoveryRecord(
    noteId: VFSNodeId,
    recordId: string,
  ): Promise<void> {
    const path = this.liveDiscoveryPath(noteId, recordId);
    const existing = await this.getContents(path);
    if (!existing.sha) {
      return;
    }

    await this.deleteContents(
      path,
      existing.sha,
      `Remove live discovery for ${noteId}`,
    );
  }
}
