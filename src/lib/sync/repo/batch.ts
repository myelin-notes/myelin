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
    public readonly diagnostics?: GitHubGitFailureDiagnostics,
  ) {
    super(message);
    this.name = 'BatchUnknownError';
  }
}

export interface GitHubGitFailureDiagnostics {
  github_git_stage: 'upload' | 'push' | 'verify';
  github_git_reason?: string;
  github_git_error_class?: string;
  github_git_error_code?: string;
  github_git_file_bytes: number;
  github_git_additions: number;
  github_git_deletions: number;
  github_git_duration_ms: number;
  github_rest_status?: number;
  github_request_id?: string;
}

export function supportsBatchedCommit<
  R extends { capabilities: RepositoryCapabilities },
>(remote: R): remote is R & BatchedCommitTarget {
  return remote.capabilities.batchedCommit === true;
}
