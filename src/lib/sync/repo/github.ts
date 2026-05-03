import { fetch } from '@tauri-apps/plugin-http';
import { BaseRepository } from './base';
import { getGitHubToken } from './github-credentials';
import {
  createEmptyManifest,
  getStoredFilePath,
  MANIFEST_PATH,
  migrate,
  type VFSManifest,
} from './shared';
import type { FileType, RepositoryCapabilities, VFSFileNode } from './types';

interface GitHubContentsResponse {
  sha: string;
  content?: string | null;
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
const MAX_MANIFEST_RETRIES = 4;

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
  };

  constructor(private readonly config: GitHubRepositoryConfig) {
    super();
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
      return { manifest: createEmptyManifest(), revision: payload.sha };
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

  protected async loadFileBytes(nodeId: string): Promise<{
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
    nodeId: string,
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
    nodeId: string,
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
    nodeId: string,
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
}
