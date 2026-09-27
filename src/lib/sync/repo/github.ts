import { fetch } from '@tauri-apps/plugin-http';
import { BaseRepository } from './base';
import {
  type BatchedCommitInput,
  type BatchedCommitResult,
  BatchHeadConflictError,
  BatchUnknownError,
  type GitHubGitFailureDiagnostics,
} from './batch';
import { getGitHubToken } from './github-credentials';
import { type GitPushResponse, pushGitHubBatch } from './github-git-push';
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
  encoding?: string;
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
const SAFE_GIT_REASONS = new Set([
  'Git staging write failed',
  'Git push task failed',
  'Invalid Git push request',
  'Git push lock unavailable',
  'Git cache unavailable',
  'Git clone failed',
  'Git fetch failed',
  'Git head unavailable',
  'Git tree unavailable',
  'Git blob write failed',
  'Git tree update failed',
  'Git commit identity failed',
  'Git commit failed',
  'Git push failed',
  'Git push rejected',
]);

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
    const sha = await this.getContentsSha(path);
    if (!sha) {
      return;
    }

    await this.deleteContents(path, sha, `Delete file ${nodeId}`);
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
    const requestId = getResponseHeader(response, 'x-github-request-id');
    const safeRequestId = requestId
      ?.replace(/[^A-Za-z0-9-]/g, '')
      .slice(0, 100);
    return new Error(
      `${label} (${response.status})${safeRequestId ? ` [request ${safeRequestId}]` : ''}`,
    );
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

  private async getContentsMetadata(
    path: string,
  ): Promise<GitHubContentsResponse | null> {
    const url = `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.config.branch)}`;
    const response = await this.sendWithRateLimitRetry(url, async () => ({
      method: 'GET',
      headers: {
        ...(await this.authHeaders()),
        Accept: 'application/vnd.github.object+json',
      },
    }));

    if (response.status === 404) {
      await this.getBranchHeadOid();
      return null;
    }

    if (!response.ok) {
      throw await this.failureError('GitHub contents request failed', response);
    }

    return (await response.json()) as GitHubContentsResponse;
  }

  private async getContents(path: string): Promise<{
    sha: string | null;
    bytes: Uint8Array | null;
  }> {
    const payload = await this.getContentsMetadata(path);
    if (!payload) {
      return { sha: null, bytes: null };
    }
    if (payload.encoding === 'none') {
      const blobUrl = `${GITHUB_API_BASE}/repos/${this.config.owner}/${this.config.repo}/git/blobs/${encodeURIComponent(payload.sha)}`;
      let blobResponse = await this.sendWithRateLimitRetry(
        blobUrl,
        async () => ({
          method: 'GET',
          headers: {
            ...(await this.authHeaders()),
            Accept: 'application/vnd.github.raw+json',
          },
          maxRedirections: 0,
        }),
      );
      if (blobResponse.status >= 300 && blobResponse.status < 400) {
        const location = getResponseHeader(blobResponse, 'location');
        if (!location) {
          throw await this.failureError(
            'GitHub blob redirect missing Location',
            blobResponse,
          );
        }
        blobResponse = await fetch(location, { method: 'GET' });
      }
      if (!blobResponse.ok) {
        throw await this.failureError(
          'GitHub blob request failed',
          blobResponse,
        );
      }
      return {
        sha: payload.sha,
        bytes: new Uint8Array(await blobResponse.arrayBuffer()),
      };
    }
    const bytes = payload.content ? base64DecodeToBytes(payload.content) : null;
    return { sha: payload.sha, bytes };
  }

  private async getContentsSha(path: string): Promise<string | null> {
    return (await this.getContentsMetadata(path))?.sha ?? null;
  }

  private async putContents(
    path: string,
    bytes: Uint8Array,
    sha: string | null,
    message: string,
  ): Promise<string> {
    for (let attempt = 0; attempt < MAX_MANIFEST_RETRIES; attempt++) {
      const expectedHeadOid = await this.getBranchHeadOid();
      const currentSha = await this.getContentsSha(path);
      if (currentSha !== sha) {
        throw new Error('GitHub write request failed (409): file changed');
      }
      try {
        const result = await this.commitGitBatch({
          additions: [{ path, contents: bytes }],
          deletions: [],
          message: { headline: message },
          expectedHeadOid,
        });
        return result.blobShas.get(path)!;
      } catch (error) {
        if (
          !(error instanceof BatchHeadConflictError) ||
          attempt === MAX_MANIFEST_RETRIES - 1
        ) {
          throw error;
        }
      }
    }
    throw new Error('GitHub write retries exhausted');
  }

  private async deleteContents(
    path: string,
    sha: string,
    message: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_MANIFEST_RETRIES; attempt++) {
      const expectedHeadOid = await this.getBranchHeadOid();
      const currentSha = await this.getContentsSha(path);
      if (!currentSha) {
        return;
      }
      if (currentSha !== sha) {
        throw new Error('GitHub delete request failed (409): file changed');
      }
      try {
        await this.commitGitBatch({
          additions: [],
          deletions: [{ path }],
          message: { headline: message },
          expectedHeadOid,
        });
        return;
      } catch (error) {
        if (
          !(error instanceof BatchHeadConflictError) ||
          attempt === MAX_MANIFEST_RETRIES - 1
        ) {
          throw error;
        }
      }
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
    return this.commitGitBatch(input);
  }

  private async commitGitBatch(
    input: BatchedCommitInput,
  ): Promise<BatchedCommitResult & { blobShas: Map<string, string> }> {
    if (
      input.additions.some(
        (addition) => addition.contents.byteLength > 100_000_000,
      )
    ) {
      throw new Error(
        "Cannot sync a file exceeding GitHub's 100 MB blob limit.",
      );
    }
    const startedAt = Date.now();
    const metrics = {
      github_git_file_bytes: input.additions.reduce(
        (total, addition) => total + addition.contents.byteLength,
        0,
      ),
      github_git_additions: input.additions.length,
      github_git_deletions: input.deletions.length,
    };
    const failure = (
      stage: GitHubGitFailureDiagnostics['github_git_stage'],
      reason?: string,
      response?: Response,
    ) => {
      const nativeDetail = reason?.match(
        /^(.+) \(([A-Za-z]{1,40})\/([A-Za-z]{1,40})\)$/,
      );
      const safeReason =
        reason &&
        (SAFE_GIT_REASONS.has(reason) ||
          (nativeDetail && SAFE_GIT_REASONS.has(nativeDetail[1] ?? '')))
          ? reason
          : null;
      const requestId = response
        ? getResponseHeader(response, 'x-github-request-id')
            ?.replace(/[^A-Za-z0-9-]/g, '')
            .slice(0, 100)
        : null;
      return new BatchUnknownError(
        `GitHub Git push failed (${stage}${safeReason ? `: ${safeReason}` : ''})`,
        null,
        {
          ...metrics,
          github_git_stage: stage,
          github_git_duration_ms: Date.now() - startedAt,
          ...(safeReason
            ? { github_git_reason: nativeDetail?.[1] ?? safeReason }
            : {}),
          ...(safeReason && nativeDetail
            ? {
                github_git_error_class: nativeDetail[2],
                github_git_error_code: nativeDetail[3],
              }
            : {}),
          ...(response ? { github_rest_status: response.status } : {}),
          ...(requestId ? { github_request_id: requestId } : {}),
        },
      );
    };
    let result: GitPushResponse;
    try {
      result = await pushGitHubBatch(
        this.config,
        input,
        await getGitHubToken(this.config.credentialId),
      );
    } catch (error) {
      throw failure(
        'upload',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (result.status === 'head-conflict') {
      throw new BatchHeadConflictError('GitHub branch head changed');
    }
    if (result.status !== 'pushed' && result.status !== 'push-failed') {
      throw failure('push');
    }
    const commitOid = result.commitOid;
    if (!commitOid || !/^[a-f0-9]{40}$/i.test(commitOid)) {
      throw failure('push');
    }
    if (result.status === 'push-failed') {
      let observedHead: string;
      try {
        observedHead = await this.getBranchHeadOid();
        if (observedHead !== commitOid) {
          const baseUrl = `${GITHUB_API_BASE}/repos/${this.config.owner}/${this.config.repo}`;
          const comparison = await this.fetchWithRateLimitRetry(
            `${baseUrl}/compare/${encodeURIComponent(commitOid)}...${encodeURIComponent(observedHead)}`,
          );
          if (!comparison.ok) {
            if (
              observedHead !== input.expectedHeadOid &&
              comparison.status === 404
            ) {
              throw new BatchHeadConflictError('GitHub branch head changed');
            }
            throw failure(
              'verify',
              result.failureReason ?? undefined,
              comparison,
            );
          }
          const body = (await comparison.json()) as { status?: string };
          if (body.status !== 'ahead' && body.status !== 'identical') {
            if (observedHead !== input.expectedHeadOid) {
              throw new BatchHeadConflictError('GitHub branch head changed');
            }
            throw failure('push', result.failureReason ?? undefined);
          }
        }
      } catch (error) {
        if (
          error instanceof BatchHeadConflictError ||
          error instanceof BatchUnknownError
        ) {
          throw error;
        }
        throw failure('verify', result.failureReason ?? undefined);
      }
    }
    if (
      input.additions.some(
        (addition) =>
          !/^[a-f0-9]{40}$/i.test(result.blobShas[addition.path] ?? ''),
      )
    ) {
      throw failure('verify');
    }
    return {
      newHeadOid: commitOid,
      blobShas: new Map(Object.entries(result.blobShas)),
    };
  }
}
