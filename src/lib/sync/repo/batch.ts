import type { VFSManifest } from './shared';
import type { RepositoryCapabilities } from './types';

export interface BatchedCommitFileChange {
  path: string;
  contents: Uint8Array;
}

export interface BatchedCommitInput {
  additions: BatchedCommitFileChange[];
  deletions: Array<{ path: string }>;
  message: { headline: string; body?: string };
  expectedHeadOid: string;
}

export interface BatchedCommitResult {
  newHeadOid: string;
}

export interface BatchedCommitTarget {
  getBranchHeadOid(): Promise<string>;
  loadManifestForBatch(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }>;
  commitBatch(input: BatchedCommitInput): Promise<BatchedCommitResult>;
}

export class BatchHeadConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchHeadConflictError';
  }
}

export class BatchUnknownError extends Error {
  constructor(
    message: string,
    public readonly details: unknown,
    public readonly diagnostics?: GitHubBatchFailureDiagnostics,
  ) {
    super(message);
    this.name = 'BatchUnknownError';
  }
}

export interface GitHubBatchFailureDiagnostics {
  github_graphql_stage: 'request' | 'http' | 'graphql' | 'response';
  github_graphql_request_chars: number;
  github_graphql_file_bytes: number;
  github_graphql_additions: number;
  github_graphql_deletions: number;
  github_graphql_duration_ms: number;
  github_graphql_status?: number;
  github_graphql_content_type?: string;
  github_graphql_response_chars?: number;
  github_request_id?: string;
}

export function supportsBatchedCommit<
  R extends { capabilities: RepositoryCapabilities },
>(remote: R): remote is R & BatchedCommitTarget {
  return remote.capabilities.batchedCommit === true;
}
