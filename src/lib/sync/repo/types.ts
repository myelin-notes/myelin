/**
 * App-side repository types. The persistence contract itself lives in
 * `@myelin/editor` (the editor consumes repositories without opening
 * sessions); the app layers session opening on top, since `NoteSession`
 * carries the app's live-sync machinery.
 */

import type {
  Repository as EditorRepository,
  VFSNodeId,
} from '@myelin/editor/sync/repo/types';
import type { NoteSession } from '../session';

export * from '@myelin/editor/sync/repo/types';

export interface Repository extends EditorRepository {
  openSession(nodeId: VFSNodeId): Promise<NoteSession>;
}

export type { NoteSession };
