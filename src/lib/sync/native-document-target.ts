import type {
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from '@myelin/editor/sync/types';

export interface NativeDocumentSnapshot extends YjsSyncSnapshot {
  generation: string;
}

export interface NativeDocumentChange {
  update: Uint8Array | null;
  origin: 'local' | 'peer' | 'repository';
  generation: string;
  replacement: boolean;
}

export interface NativeDocumentTarget extends YjsSyncTarget {
  readonly nativeRepositoryHandle: string;
  loadDocument(nodeId: string): Promise<NativeDocumentSnapshot>;
  pullUpdates(
    nodeId: string,
    stateVector?: Uint8Array | null,
  ): Promise<NativeDocumentSnapshot>;
  persistDocumentUpdate(
    nodeId: string,
    update: Uint8Array,
    generation?: string,
    sourceSession?: string,
  ): Promise<YjsSyncPushResult>;
  flushDocument(nodeId: string): Promise<void>;
  subscribeDocument(
    nodeId: string,
    listener: (change: NativeDocumentChange) => void,
    sessionId: string,
  ): Promise<() => Promise<void>>;
}

export function isNativeDocumentTarget(
  target: YjsSyncTarget,
): target is NativeDocumentTarget {
  return 'persistDocumentUpdate' in target && 'subscribeDocument' in target;
}
