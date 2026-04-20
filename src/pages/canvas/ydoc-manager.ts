import * as Y from 'yjs';
import type { ElementType } from './elements/element-type';

/** Origins used to label Yjs updates flowing through the canvas sync layer. */
export const LOCAL_ORIGIN = 'local' as const;
export type LocalOrigin = typeof LOCAL_ORIGIN;
export const PEER_ORIGIN = 'remote-peer' as const;
export type PeerOrigin = typeof PEER_ORIGIN;
export type SyncOrigin = LocalOrigin | PeerOrigin;

/**
 * Owns a Y.Doc for a single canvas file and provides typed access
 * to its shared types and undo manager.
 *
 * ## Structure
 * ```
 * Y.Doc
 * ├── Y.Map('meta')          → { nextIndex: number }
 * ├── Y.Array('elements')    → [ Y.Map, ... ]  per element
 * └── Y.XmlFragment('pf-N')  → one per PageFrameElement, keyed by element index
 * ```
 */
export class YDocManager {
  public readonly doc: Y.Doc;
  public readonly meta: Y.Map<unknown>;
  public readonly elements: Y.Array<Y.Map<unknown>>;
  public readonly undoManager: Y.UndoManager;

  constructor(doc?: Y.Doc) {
    this.doc = doc ?? new Y.Doc();
    this.meta = this.doc.getMap('meta');
    this.elements = this.doc.getArray('elements');
    this.undoManager = new Y.UndoManager([this.elements], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 500,
    });
  }

  get nextIndex(): number {
    return (this.meta.get('nextIndex') as number) ?? 0;
  }

  set nextIndex(value: number) {
    this.meta.set('nextIndex', value);
  }

  /**
   * Create a new element Y.Map, populate it, and append to the elements array.
   * All inside one transaction so the Y.Array observer sees a fully-populated map.
   */
  createElementMap(
    type: ElementType,
    index: number,
    props: Record<string, unknown>,
  ): Y.Map<unknown> {
    const yMap = new Y.Map<unknown>();
    this.doc.transact(() => {
      yMap.set('type', type);
      yMap.set('index', index);
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
    index: number,
    props: Record<string, unknown>,
  ): Y.Map<unknown> {
    const yMap = new Y.Map<unknown>();
    this.doc.transact(() => {
      yMap.set('type', type);
      yMap.set('index', index);
      for (const [key, value] of Object.entries(props)) {
        yMap.set(key, value);
      }
      this.elements.insert(position, [yMap]);
    }, LOCAL_ORIGIN);
    return yMap;
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
   * The fragment key uses the stable element index rather than the element's
   * current position in the Y.Array, so page content stays attached across
   * reordering and deletion of other elements.
   */
  getXmlFragment(elementIndex: number): Y.XmlFragment {
    return this.doc.getXmlFragment(`pf-${elementIndex}`);
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
