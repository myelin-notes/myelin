import { invoke, isTauri } from '@tauri-apps/api/core';
import type { RepositoryConfig } from './config';
import { getGitHubToken } from './github/credentials';
import { getGoogleDriveToken } from './google-drive/credentials';

interface PreparedRepositoryCache {
  stageId: string;
  fileCount: number;
  byteLength: number;
}

export interface NativeRepositoryBootstrap {
  recover(): Promise<void>;
  prepare(): Promise<PreparedRepositoryCache>;
  install(stageId: string): Promise<boolean>;
  discard(stageId: string): Promise<void>;
}

export function createNativeRepositoryBootstrap(
  config: RepositoryConfig,
  storageRoot: string,
): NativeRepositoryBootstrap | undefined {
  if (!isTauri() || config.kind === 'local') {
    return undefined;
  }

  return {
    recover: () => invoke('recover_repository_cache', { storageRoot }),
    async prepare() {
      const stageId = crypto.randomUUID();
      const prepare = async (forceRefresh = false) => {
        const source =
          config.kind === 'github'
            ? {
                kind: config.kind,
                owner: config.owner,
                repo: config.repo,
                branch: config.branch ?? 'main',
                token: await getGitHubToken(config.credentialId),
              }
            : {
                kind: config.kind,
                folderId: config.folderId,
                token: await getGoogleDriveToken(config.credentialId, {
                  forceRefresh,
                }),
              };
        return invoke<PreparedRepositoryCache>('prepare_repository_cache', {
          storageRoot,
          stageId,
          source,
        });
      };
      try {
        return await prepare();
      } catch (error) {
        if (config.kind === 'google-drive' && String(error).includes('(401)')) {
          return prepare(true);
        }
        throw error;
      }
    },
    install: (stageId) =>
      invoke('install_repository_cache', { storageRoot, stageId }),
    discard: (stageId) =>
      invoke('discard_repository_cache', { storageRoot, stageId }),
  };
}
