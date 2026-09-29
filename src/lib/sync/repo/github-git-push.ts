import { invoke } from '@tauri-apps/api/core';
import { BaseDirectory, mkdir, open, remove } from '@tauri-apps/plugin-fs';
import type { BatchedCommitInput } from './batch';

const STAGING_CHUNK_BYTES = 16 * 1024;

export interface GitPushResponse {
  status: 'pushed' | 'head-conflict' | 'push-failed';
  commitOid: string | null;
  blobShas: Record<string, string>;
  failureReason?: string | null;
}

export async function pushGitHubBatch(
  config: { owner: string; repo: string; branch: string },
  input: BatchedCommitInput,
  token: string,
): Promise<GitPushResponse> {
  const stagingId = crypto.randomUUID();
  const stagingPath = `git-sync/${stagingId}`;
  let stage = 'directory';
  try {
    await mkdir(stagingPath, {
      baseDir: BaseDirectory.AppCache,
      recursive: true,
    });
    for (const [index, addition] of input.additions.entries()) {
      stage = 'file';
      const file = await open(`${stagingPath}/${index}`, {
        baseDir: BaseDirectory.AppCache,
        write: true,
        create: true,
        truncate: true,
      });
      try {
        stage = 'write';
        for (let offset = 0; offset < addition.contents.byteLength; ) {
          const written = await file.write(
            addition.contents.subarray(offset, offset + STAGING_CHUNK_BYTES),
          );
          if (written <= 0) {
            throw new Error('Git staging write failed');
          }
          offset += written;
          if (offset < addition.contents.byteLength) {
            await new Promise<void>((resolve) => {
              if (document.visibilityState === 'visible') {
                requestAnimationFrame(() => setTimeout(resolve, 0));
              } else {
                setTimeout(resolve, 0);
              }
            });
          }
        }
      } finally {
        await file.close();
      }
    }
    stage = 'push';
    return await invoke<GitPushResponse>('github_push_batch', {
      request: {
        owner: config.owner,
        repo: config.repo,
        branch: config.branch,
        token,
        expectedHeadOid: input.expectedHeadOid,
        message: input.message.body
          ? `${input.message.headline}\n\n${input.message.body}`
          : input.message.headline,
        stagingId,
        additions: input.additions.map((addition, index) => ({
          path: addition.path,
          index,
        })),
        deletions: input.deletions.map((deletion) => deletion.path),
      },
    });
  } catch (error) {
    if (stage === 'push') {
      throw error;
    }
    throw new Error(`Git staging ${stage} failed`);
  } finally {
    await remove(stagingPath, {
      baseDir: BaseDirectory.AppCache,
      recursive: true,
    }).catch(() => {});
  }
}
