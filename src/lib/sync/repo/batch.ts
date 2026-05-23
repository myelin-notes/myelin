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
  ) {
    super(message);
    this.name = 'BatchUnknownError';
  }
}

export function supportsBatchedCommit<
  R extends { capabilities: RepositoryCapabilities },
>(remote: R): remote is R & BatchedCommitTarget {
  return remote.capabilities.batchedCommit === true;
}
