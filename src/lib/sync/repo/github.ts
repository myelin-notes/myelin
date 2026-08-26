import { fetch } from '@tauri-apps/plugin-http';
import { BaseRepository } from './base';
import {
  type BatchedCommitInput,
  type BatchedCommitResult,
  BatchHeadConflictError,
  BatchUnknownError,
} from './batch';
import { getGitHubToken } from './github-credentials';
import {
  createEmptyManifest,
  getStoredFilePath,
  MANIFEST_PATH,
  migrate,
  type RepositorySnapshot,
  type VFSManifest,
} from './shared';
import { readGzippedTarballEntries } from './tar';
import type {
  FileType,
  RepositoryCapabilities,
  VFSFileNode,
  VFSNodeId,
} from './types';

const RATE_LIMIT_MAX_RETRY_DELAY_MS = 60_000;

interface ResponseHeaders {
  get(name: string): string | null;
}

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
const GITHUB_GRAPHQL_URL = `${GITHUB_API_BASE}/graphql`;
const GITHUB_API_VERSION = '2022-11-28';
const MAX_MANIFEST_RETRIES = 4;

// Chunked so multi-MB media doesn't pay a per-byte string-concatenation cost. 0x8000 keeps the
// apply() argument count well under engine call-stack limits.
const BASE64_CHUNK_SIZE = 0x8000;

function base64EncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
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

function getResponseHeader(
  response: { headers?: ResponseHeaders },
  name: string,
): string | null {
  return response.headers?.get(name) ?? null;
}

function isRateLimited(response: { status: number }): boolean {
  return response.status === 403 || response.status === 429;
}

function readRateLimitDelayMs(response: {
  status: number;
  headers?: ResponseHeaders;
}): number | null {
  const retryAfter = getResponseHeader(response, 'retry-after');
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, RATE_LIMIT_MAX_RETRY_DELAY_MS);
    }
  }

  const resetHeader = getResponseHeader(response, 'x-ratelimit-reset');
  if (resetHeader) {
    const resetEpochSeconds = Number.parseInt(resetHeader, 10);
    if (Number.isFinite(resetEpochSeconds)) {
      const deltaMs = resetEpochSeconds * 1000 - Date.now();
      if (deltaMs > 0) {
        return Math.min(deltaMs, RATE_LIMIT_MAX_RETRY_DELAY_MS);
      }
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GitHubRepository extends BaseRepository {
  public readonly kind = 'github';
  public readonly capabilities: RepositoryCapabilities = {
    polling: true,
    liveSync: false,
    batchedCommit: true,
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

  // The abstract signature is string | null (LocalRepository uses null for "no revision"), but
  // putContents always resolves to a non-null commit sha or throws.
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

  async exportSnapshot(): Promise<RepositorySnapshot> {
    const { manifest } = await this.loadManifestImpl();
    const fileNodes = Object.values(manifest.nodes).filter(
      (node): node is VFSFileNode => node.type === 'file',
    );

    if (fileNodes.length === 0) {
      return { manifest, notes: {} };
    }

    const entries = await this.fetchTarballEntries();
    const notes: Record<VFSNodeId, Uint8Array | null> = {};
    for (const node of fileNodes) {
      notes[node.id] = entries.get(getStoredFilePath(node)) ?? null;
    }

    return { manifest, notes };
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

  private fetchWithRateLimitRetry(
    url: string,
    init: { maxRedirections?: number } = {},
  ): Promise<Response> {
    return this.sendWithRateLimitRetry(url, async () => ({
      method: 'GET',
      headers: await this.authHeaders(),
      ...init,
    }));
  }

  // buildInit is re-invoked per attempt so authHeaders() (and any refreshed token) is picked up on
  // retry. On a 403/429 with a Retry-After or X-RateLimit-Reset hint, sleeps once and retries.
  private async sendWithRateLimitRetry(
    url: string,
    buildInit: () => Promise<{
      method: string;
      headers: Record<string, string>;
      body?: string;
      maxRedirections?: number;
    }>,
  ): Promise<Response> {
    const send = async () => fetch(url, await buildInit());
    let response = await send();
    if (isRateLimited(response)) {
      const delayMs = readRateLimitDelayMs(response);
      if (delayMs !== null) {
        await sleep(delayMs);
        response = await send();
      }
    }
    return response;
  }

  private async fetchTarballEntries(): Promise<Map<string, Uint8Array>> {
    const ref = encodeURIComponent(this.config.branch);
    const url = `${GITHUB_API_BASE}/repos/${this.config.owner}/${this.config.repo}/tarball/${ref}`;

    // maxRedirections: 0 keeps Authorization off the codeload.github.com hop.
    let response = await this.fetchWithRateLimitRetry(url, {
      maxRedirections: 0,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = getResponseHeader(response, 'location');
      if (!location) {
        throw await this.failureError(
          'GitHub tarball redirect missing Location',
          response,
        );
      }
      response = await fetch(location, { method: 'GET' });
    }

    if (!response.ok) {
      throw await this.failureError('GitHub tarball request failed', response);
    }

    const gzipped = new Uint8Array(await response.arrayBuffer());
    return readGzippedTarballEntries(gzipped);
  }

  private async getContents(path: string): Promise<{
    sha: string | null;
    bytes: Uint8Array | null;
  }> {
    const url = `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.config.branch)}`;
    const response = await this.fetchWithRateLimitRetry(url);

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
    const response = await this.sendWithRateLimitRetry(
      this.contentsUrl(path),
      async () => ({
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
      }),
    );

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
    const response = await this.sendWithRateLimitRetry(
      this.contentsUrl(path),
      async () => ({
        method: 'DELETE',
        headers: {
          ...(await this.authHeaders()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, sha, branch: this.config.branch }),
      }),
    );

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw await this.failureError('GitHub delete request failed', response);
    }
  }

  async getBranchHeadOid(): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${this.config.owner}/${this.config.repo}/branches/${encodeURIComponent(this.config.branch)}`;
    const response = await this.fetchWithRateLimitRetry(url);
    if (!response.ok) {
      throw await this.failureError('GitHub branch request failed', response);
    }
    const payload = (await response.json()) as { commit: { sha: string } };
    return payload.commit.sha;
  }

  async loadManifestForBatch(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }> {
    return this.loadManifestImpl();
  }

  async commitBatch(input: BatchedCommitInput): Promise<BatchedCommitResult> {
    const additions = input.additions.map((change) => ({
      path: change.path,
      contents: base64EncodeBytes(change.contents),
    }));
    const variables = {
      input: {
        branch: {
          repositoryNameWithOwner: `${this.config.owner}/${this.config.repo}`,
          branchName: this.config.branch,
        },
        expectedHeadOid: input.expectedHeadOid,
        message: input.message.body
          ? { headline: input.message.headline, body: input.message.body }
          : { headline: input.message.headline },
        fileChanges: {
          additions,
          deletions: input.deletions.map((d) => ({ path: d.path })),
        },
      },
    };

    const response = await fetch(GITHUB_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        ...(await this.authHeaders()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query:
          'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }',
        variables,
      }),
    });

    if (!response.ok) {
      throw new BatchUnknownError(
        `GitHub GraphQL request failed (${response.status})`,
        await response.text().catch(() => '<no response body>'),
      );
    }

    const body = (await response.json()) as {
      data?: { createCommitOnBranch?: { commit?: { oid?: string } } };
      errors?: Array<{ message?: string; type?: string }>;
    };

    if (body.errors && body.errors.length > 0) {
      const firstMessage = body.errors[0]?.message ?? '';
      if (isHeadConflictMessage(firstMessage)) {
        throw new BatchHeadConflictError(firstMessage);
      }
      throw new BatchUnknownError(
        `GitHub GraphQL returned errors: ${firstMessage}`,
        body.errors,
      );
    }

    const newOid = body.data?.createCommitOnBranch?.commit?.oid;
    if (!newOid) {
      throw new BatchUnknownError(
        'GitHub GraphQL response missing commit oid',
        body,
      );
    }
    return { newHeadOid: newOid };
  }
}

function isHeadConflictMessage(message: string): boolean {
  const lower = message.toLowerCase();
  if (lower.includes('stale_data')) {
    return true;
  }
  return lower.includes('expected') && lower.includes('oid');
}
