import type { YjsSyncTarget } from '../types';
import type { Repository } from './types';

export type RepositoryConfig =
  | { kind: 'local' }
  | {
      kind: 'github';
      owner: string;
      repo: string;
      branch?: string;
      credentialId: string;
    }
  | {
      kind: 'google-drive';
      /** Display name of the app-created Drive folder; the user may rename it. */
      folderName: string;
      /** Drive id of that folder, resolved once during setup. */
      folderId: string;
      credentialId: string;
    };

export interface RepositoryLifecycle {
  initialize(): Promise<void>;
  refresh(): Promise<void>;
  flushPending(): Promise<void>;
  dispose(): Promise<void>;
}

export interface RepositoryRuntimeStatus {
  online: boolean;
  pendingRemoteWrites: number;
  lastRemoteSyncAt: number | null;
  lastError: Error | null;
  /**
   * Incremented on every local repository mutation — including ones made outside the current view,
   * such as the tab bar creating a file for a new tab. Unlike `lastRemoteSyncAt`, this advances for
   * local repositories too.
   */
  dataVersion: number;
}

export interface RepositoryStatusSource {
  getRuntimeStatus(): RepositoryRuntimeStatus;
  subscribeStatus(
    listener: (status: RepositoryRuntimeStatus) => void,
  ): () => void;
}

/** A repository that can be read and have its note documents loaded. */
export type ReadableRepository = Repository &
  Pick<YjsSyncTarget, 'loadDocument'>;

export type ActiveRepository = Repository &
  YjsSyncTarget &
  RepositoryLifecycle &
  RepositoryStatusSource;

export const DEFAULT_REPOSITORY_CONFIG: RepositoryConfig = { kind: 'local' };

export const DEFAULT_GOOGLE_DRIVE_FOLDER_NAME = 'Myelin';

export const MAX_CUSTOM_COLORS = 8;

export const MAX_PEN_PRESETS = 6;
