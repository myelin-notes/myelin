import { fetch } from '@tauri-apps/plugin-http';
import { BaseRepository } from './base';
import {
  type BatchedCommitInput,
  type BatchedCommitResult,
  BatchHeadConflictError,
  BatchUnknownError,
  type GitHubBatchFailureDiagnostics,
  type GitHubRestFailureDiagnostics,
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
  encoding?: string;
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
const MAX_GRAPHQL_FILE_BYTES = 8 * 1024 * 1024;

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
    const response = await this.sendWithRateLimitRetry(url, async () => ({
      method: 'GET',
      headers: {
        ...(await this.authHeaders()),
        Accept: 'application/vnd.github.object+json',
      },
    }));

    if (response.status === 404) {
      await this.getBranchHeadOid();
      return { sha: null, bytes: null };
    }

    if (!response.ok) {
      throw await this.failureError('GitHub contents request failed', response);
    }

    const payload = (await response.json()) as GitHubContentsResponse;
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

  private async putContents(
    path: string,
    bytes: Uint8Array,
    sha: string | null,
    message: string,
  ): Promise<string> {
    if (bytes.byteLength > MAX_GRAPHQL_FILE_BYTES) {
      for (let attempt = 0; attempt < MAX_MANIFEST_RETRIES; attempt++) {
        const expectedHeadOid = await this.getBranchHeadOid();
        const response = await this.sendWithRateLimitRetry(
          `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.config.branch)}`,
          async () => ({
            method: 'GET',
            headers: {
              ...(await this.authHeaders()),
              Accept: 'application/vnd.github.object+json',
            },
          }),
        );
        if (response.status !== 404 && !response.ok) {
          throw await this.failureError(
            'GitHub contents request failed',
            response,
          );
        }
        const currentSha = response.ok
          ? ((await response.json()) as GitHubContentsResponse).sha
          : null;
        if (currentSha !== sha) {
          throw new Error('GitHub write request failed (409): file changed');
        }
        try {
          const result = await this.commitLargeBatch({
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
    }

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
    if (
      input.additions.reduce(
        (total, addition) => total + addition.contents.byteLength,
        0,
      ) > MAX_GRAPHQL_FILE_BYTES
    ) {
      return this.commitLargeBatch(input);
    }

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
    const requestBody = JSON.stringify({
      query:
        'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }',
      variables,
    });
    const requestMetrics = {
      github_graphql_request_chars: requestBody.length,
      github_graphql_file_bytes: input.additions.reduce(
        (total, addition) => total + addition.contents.byteLength,
        0,
      ),
      github_graphql_additions: input.additions.length,
      github_graphql_deletions: input.deletions.length,
    };
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(GITHUB_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          ...(await this.authHeaders()),
          'Content-Type': 'application/json',
        },
        body: requestBody,
      });
    } catch (error) {
      throw new BatchUnknownError(
        'GitHub GraphQL request failed before receiving a response',
        error,
        {
          ...requestMetrics,
          github_graphql_stage: 'request',
          github_graphql_duration_ms: Date.now() - startedAt,
        },
      );
    }

    const requestId = response.headers?.get('x-github-request-id');
    const contentType = response.headers?.get('content-type');
    const responseMetrics: GitHubBatchFailureDiagnostics = {
      ...requestMetrics,
      github_graphql_stage: 'http',
      github_graphql_duration_ms: Date.now() - startedAt,
      github_graphql_status: response.status,
      ...(contentType
        ? { github_graphql_content_type: contentType.slice(0, 100) }
        : {}),
      ...(requestId ? { github_request_id: requestId.slice(0, 100) } : {}),
    };

    if (!response.ok) {
      const responseBody = await response
        .text()
        .catch(() => '<no response body>');
      throw new BatchUnknownError(
        `GitHub GraphQL request failed (${response.status})`,
        responseBody,
        {
          ...responseMetrics,
          github_graphql_response_chars: responseBody.length,
        },
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
        { ...responseMetrics, github_graphql_stage: 'graphql' },
      );
    }

    const newOid = body.data?.createCommitOnBranch?.commit?.oid;
    if (!newOid) {
      throw new BatchUnknownError(
        'GitHub GraphQL response missing commit oid',
        body,
        { ...responseMetrics, github_graphql_stage: 'response' },
      );
    }
    return { newHeadOid: newOid };
  }

  private async commitLargeBatch(
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
    const baseUrl = `${GITHUB_API_BASE}/repos/${this.config.owner}/${this.config.repo}`;
    const startedAt = Date.now();
    const metrics = {
      github_rest_file_bytes: input.additions.reduce(
        (total, addition) => total + addition.contents.byteLength,
        0,
      ),
      github_rest_additions: input.additions.length,
      github_rest_deletions: input.deletions.length,
    };
    const failure = (
      stage: GitHubRestFailureDiagnostics['github_rest_stage'],
      message: string,
      details: unknown = null,
      extra: Partial<GitHubRestFailureDiagnostics> = {},
    ) =>
      new BatchUnknownError(message, details, {
        ...metrics,
        github_rest_stage: stage,
        github_rest_duration_ms: Date.now() - startedAt,
        ...extra,
      });
    const request = async <T>(
      stage: GitHubRestFailureDiagnostics['github_rest_stage'],
      url: string,
      method: 'GET' | 'POST' | 'PATCH',
      body?: object,
    ): Promise<T> => {
      const requestBody = body ? JSON.stringify(body) : undefined;
      let response: Response;
      try {
        response = await this.sendWithRateLimitRetry(url, async () => ({
          method,
          headers: {
            ...(await this.authHeaders()),
            ...(requestBody ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(requestBody ? { body: requestBody } : {}),
        }));
      } catch (error) {
        throw failure(
          stage,
          `GitHub REST ${stage} request failed`,
          error,
          requestBody ? { github_rest_request_chars: requestBody.length } : {},
        );
      }
      if (!response.ok) {
        const contentType = getResponseHeader(response, 'content-type');
        const requestId = getResponseHeader(response, 'x-github-request-id');
        throw failure(
          stage,
          `GitHub REST ${stage} request failed (${response.status})`,
          null,
          {
            github_rest_status: response.status,
            ...(requestBody
              ? { github_rest_request_chars: requestBody.length }
              : {}),
            ...(contentType
              ? { github_rest_content_type: contentType.slice(0, 100) }
              : {}),
            ...(requestId
              ? { github_request_id: requestId.slice(0, 100) }
              : {}),
          },
        );
      }
      try {
        return (await response.json()) as T;
      } catch (error) {
        throw failure(
          stage,
          `GitHub REST ${stage} response was invalid`,
          error,
          { github_rest_status: response.status },
        );
      }
    };
    const requireSha = (
      sha: unknown,
      stage: GitHubRestFailureDiagnostics['github_rest_stage'],
    ): string => {
      if (typeof sha !== 'string' || !sha) {
        throw failure(stage, `GitHub REST ${stage} response missing sha`);
      }
      return sha;
    };

    const parent = await request<{ tree: { sha: string } }>(
      'parent',
      `${baseUrl}/git/commits/${encodeURIComponent(input.expectedHeadOid)}`,
      'GET',
    );
    const parentTreeSha = requireSha(parent?.tree?.sha, 'parent');
    const treeEntries: Array<{
      path: string;
      mode: '100644';
      type: 'blob';
      sha: string | null;
    }> = [];
    const blobShas = new Map<string, string>();
    for (const addition of input.additions) {
      const blob = await request<{ sha: string }>(
        'blob',
        `${baseUrl}/git/blobs`,
        'POST',
        { content: base64EncodeBytes(addition.contents), encoding: 'base64' },
      );
      const blobSha = requireSha(blob?.sha, 'blob');
      treeEntries.push({
        path: addition.path,
        mode: '100644',
        type: 'blob',
        sha: blobSha,
      });
      blobShas.set(addition.path, blobSha);
    }
    for (const deletion of input.deletions) {
      treeEntries.push({
        path: deletion.path,
        mode: '100644',
        type: 'blob',
        sha: null,
      });
    }
    const tree = await request<{ sha: string }>(
      'tree',
      `${baseUrl}/git/trees`,
      'POST',
      { base_tree: parentTreeSha, tree: treeEntries },
    );
    const treeSha = requireSha(tree?.sha, 'tree');
    const commit = await request<{ sha: string }>(
      'commit',
      `${baseUrl}/git/commits`,
      'POST',
      {
        message: input.message.body
          ? `${input.message.headline}\n\n${input.message.body}`
          : input.message.headline,
        tree: treeSha,
        parents: [input.expectedHeadOid],
      },
    );
    const commitSha = requireSha(commit?.sha, 'commit');

    try {
      const ref = await request<{ object?: { sha?: string } }>(
        'ref',
        `${baseUrl}/git/refs/heads/${this.config.branch.split('/').map(encodeURIComponent).join('/')}`,
        'PATCH',
        { sha: commitSha, force: false },
      );
      if (ref?.object?.sha !== commitSha) {
        throw failure('ref', 'GitHub REST ref response missing sha');
      }
    } catch (error) {
      let observedHead: string;
      try {
        observedHead = await this.getBranchHeadOid();
        if (observedHead === commitSha) {
          return { newHeadOid: commitSha, blobShas };
        }
        const comparison = await request<{ status: string }>(
          'verify',
          `${baseUrl}/compare/${encodeURIComponent(commitSha)}...${encodeURIComponent(observedHead)}`,
          'GET',
        );
        if (
          comparison.status === 'ahead' ||
          comparison.status === 'identical'
        ) {
          return { newHeadOid: commitSha, blobShas };
        }
      } catch {
        throw error;
      }
      const status =
        error instanceof BatchUnknownError &&
        error.diagnostics &&
        'github_rest_status' in error.diagnostics
          ? error.diagnostics.github_rest_status
          : undefined;
      if (
        observedHead !== input.expectedHeadOid &&
        (status === 409 || status === 422)
      ) {
        throw new BatchHeadConflictError('GitHub branch head changed');
      }
      throw error;
    }
    return { newHeadOid: commitSha, blobShas };
  }
}

function isHeadConflictMessage(message: string): boolean {
  const lower = message.toLowerCase();
  if (lower.includes('stale_data')) {
    return true;
  }
  return lower.includes('expected') && lower.includes('oid');
}
