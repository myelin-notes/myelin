import type { YjsSyncSnapshot } from '@myelin/editor/sync/types';
import type { NativeRepository } from './repo/native';

export interface NativeDocumentSnapshot extends YjsSyncSnapshot {
  generation: string;
}

export interface NativeDocumentChange {
  update: Uint8Array | null;
  origin: 'local' | 'peer' | 'repository';
  generation: string;
  replacement: boolean;
}

export interface NativeDocumentWriteResult {
  stateVector: Uint8Array;
  revision: string | null;
  accepted: boolean;
  changed: boolean;
}

export type NativeDocumentTarget = Pick<
  NativeRepository,
  | 'nativeRepositoryHandle'
  | 'loadDocument'
  | 'pullUpdates'
  | 'persistDocumentUpdate'
  | 'flushDocument'
  | 'subscribeDocument'
>;
