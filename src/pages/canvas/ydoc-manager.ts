import * as Y from 'yjs';
import type { ElementType } from './elements/element-type';

/** Origins used to label Yjs updates flowing through the canvas sync layer. */
export const LOCAL_ORIGIN = 'local' as const;
export type LocalOrigin = typeof LOCAL_ORIGIN;
export const PEER_ORIGIN = 'remote-peer' as const;
export type PeerOrigin = typeof PEER_ORIGIN;
export const REPOSITORY_SYNC_ORIGIN = 'repository-sync' as const;
export type RepositorySyncOrigin = typeof REPOSITORY_SYNC_ORIGIN;
export type SyncOrigin = LocalOrigin | PeerOrigin | RepositorySyncOrigin;

/**
 * Owns a Y.Doc for a single canvas file and provides typed access
 * to its shared types and undo manager.
 *
 * ## Structure
 * ```
 * Y.Doc
 * ├── Y.Array('elements')      → [ Y.Map, ... ]  per element
 * └── Y.XmlFragment('pf-<uuid>') → one per PageFrameElement, keyed by element uuid
 * ```
 */
export class YDocManager {
  public readonly doc: Y.Doc;
  public readonly elements: Y.Array<Y.Map<unknown>>;
  public readonly undoManager: Y.UndoManager;

  constructor(doc?: Y.Doc) {
    this.doc = doc ?? new Y.Doc();
    this.elements = this.doc.getArray('elements');
    this.undoManager = new Y.UndoManager([this.elements], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 500,
    });
  }

  /**
   * Create a new element Y.Map, populate it, and append to the elements array.
   * All inside one transaction so the Y.Array observer sees a fully-populated map.
   */
  createElementMap(
    type: ElementType,
    uuid: string,
    props: Record<string, unknown>,
  ): Y.Map<unknown> {
    const yMap = new Y.Map<unknown>();
    this.doc.transact(() => {
      yMap.set('type', type);
      yMap.set('uuid', uuid);
      for (const [key, value] of Object.entries(props)) {
        yMap.set(key, value);
      }
      this.elements.push([yMap]);
    }, LOCAL_ORIGIN);
    return yMap;
  }

  /**
   * Insert an element Y.Map at a specific position (for page frames that
   * need to be at the front).
   */
  insertElementMap(
    position: number,
    type: ElementType,
    uuid: string,
    props: Record<string, unknown>,
  ): Y.Map<unknown> {
    const yMap = new Y.Map<unknown>();
    this.doc.transact(() => {
      yMap.set('type', type);
      yMap.set('uuid', uuid);
      for (const [key, value] of Object.entries(props)) {
        yMap.set(key, value);
      }
      this.elements.insert(position, [yMap]);
    }, LOCAL_ORIGIN);
    return yMap;
  }

  /** Insert a pre-built detached Y.Map into the elements array. */
  insertExistingElementMap(position: number, yMap: Y.Map<unknown>): void {
    const clamped = Math.max(0, Math.min(position, this.elements.length));
    this.doc.transact(() => {
      this.elements.insert(clamped, [yMap]);
    }, LOCAL_ORIGIN);
  }

  /** Remove an element's Y.Map from the elements array. */
  removeElementMap(yMap: Y.Map<unknown>): void {
    this.doc.transact(() => {
      for (let i = 0; i < this.elements.length; i++) {
        if (this.elements.get(i) === yMap) {
          this.elements.delete(i, 1);
          return;
        }
      }
    }, LOCAL_ORIGIN);
  }

  /**
   * Get or create the Y.XmlFragment for a PageFrame's ProseMirror content.
   *
   * The fragment key uses the element's stable uuid, so page content stays
   * attached across reordering and deletion of other elements.
   */
  getXmlFragment(elementUuid: string): Y.XmlFragment {
    return this.doc.getXmlFragment(`pf-${elementUuid}`);
  }

  /** Wrap a mutation in a transaction with the local origin. */
  transact(fn: () => void): void {
    this.doc.transact(fn, LOCAL_ORIGIN);
  }

  /** Encode the full document state for persistence. */
  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  /** Encode the document state vector for diff-based sync. */
  encodeStateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  /** Encode only the updates missing from the given state vector. */
  encodeDiff(stateVector?: Uint8Array | null): Uint8Array {
    return stateVector
      ? Y.encodeStateAsUpdate(this.doc, stateVector)
      : Y.encodeStateAsUpdate(this.doc);
  }

  /** Apply a remote or external Yjs update to this document. */
  applyUpdate(update: Uint8Array, origin?: unknown): void {
    Y.applyUpdate(this.doc, update, origin);
  }

  /** Create a YDocManager from a persisted state. */
  static fromUpdate(bytes: Uint8Array): YDocManager {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytes);
    return new YDocManager(doc);
  }
}
