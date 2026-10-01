import {
  addChild,
  createFileNode,
  ensureVersionHistoryRoot,
  type VFSManifest,
} from './shared';
import type { ManifestRecoveryResult, VFSNodeId } from './types';

export interface RecoverableNote {
  id: VFSNodeId;
  bytes: Uint8Array;
  stateVector: Map<number, number>;
  revision: string | null;
  createdAt: number | null;
  modifiedAt: number | null;
  kind: 'note' | 'file-version' | null;
  sourceFileId: VFSNodeId | null;
  capturedAt: number | null;
}

export interface RecoveredManifest extends ManifestRecoveryResult {
  nodeIds: VFSNodeId[];
}

export function recoverManifestNodes(
  manifest: VFSManifest,
  notes: RecoverableNote[],
  deletedIds: ReadonlySet<VFSNodeId>,
): RecoveredManifest {
  const available = notes.filter((note) => !deletedIds.has(note.id));
  const byId = new Map(available.map((note) => [note.id, note]));
  const sources = available.filter(
    (note) => note.kind !== 'file-version' && !manifest.nodes[note.id]?.system,
  );
  const versions = new Map<VFSNodeId, VFSNodeId>();

  for (const note of available) {
    if (manifest.nodes[note.id] || note.kind === 'note') {
      continue;
    }
    if (note.sourceFileId) {
      const source = byId.get(note.sourceFileId);
      if (source && sources.includes(source) && source.id !== note.id) {
        versions.set(note.id, source.id);
      }
      continue;
    }
    if (note.kind === 'file-version' || note.stateVector.size === 0) {
      continue;
    }

    // Legacy snapshots share Yjs clocks with their source; infer from the oldest Drive file.
    // Missing/tied dates remain visible as ordinary notes.
    // ponytail: O(n²) comparisons; index by Yjs client ID if recovery becomes slow.
    const candidates = sources
      .filter(
        (source) =>
          source.createdAt !== null &&
          note.createdAt !== null &&
          source.createdAt < note.createdAt &&
          [...note.stateVector].every(
            ([client, clock]) => (source.stateVector.get(client) ?? 0) >= clock,
          ),
      )
      .sort((left, right) => left.createdAt! - right.createdAt!);
    const known = candidates.filter(
      (source) =>
        source.kind === 'note' || manifest.nodes[source.id]?.type === 'file',
    );
    const source = known.length > 0 ? known[0] : candidates[0];
    if (
      source &&
      known.length <= 1 &&
      (known.length === 1 || candidates[1]?.createdAt !== source.createdAt)
    ) {
      versions.set(note.id, source.id);
    }
  }

  const result: RecoveredManifest = {
    nodeIds: [],
    notesRecovered: 0,
    versionsRecovered: 0,
  };
  const now = Date.now();
  const addNote = (note: RecoverableNote) => {
    const node = createFileNode(
      note.id,
      note.id,
      'mcanvas',
      null,
      note.createdAt ?? now,
    );
    node.modifiedAt = note.modifiedAt ?? now;
    manifest.nodes[note.id] = node;
    addChild(manifest, null, note.id);
    result.nodeIds.push(note.id);
    result.notesRecovered++;
  };

  for (const note of available) {
    if (!manifest.nodes[note.id] && !versions.has(note.id)) {
      addNote(note);
    }
  }
  for (const [versionId, sourceId] of versions) {
    const note = byId.get(versionId)!;
    const source = manifest.nodes[sourceId];
    if (source?.type !== 'file' || source.system) {
      addNote(note);
      continue;
    }
    const parentId = ensureVersionHistoryRoot(manifest, now);
    if (!result.nodeIds.includes(parentId)) {
      result.nodeIds.push(parentId);
    }
    const capturedAt = note.capturedAt ?? note.createdAt ?? now;
    const node = createFileNode(
      note.id,
      `${source.name} ${new Date(capturedAt).toISOString()}`,
      'mcanvas',
      parentId,
      note.createdAt ?? capturedAt,
      {
        kind: 'file-version',
        sourceFileId: source.id,
        sourceFileType: 'mcanvas',
        sourceName: source.name,
        sourceRevision: note.revision,
        capturedAt,
        byteLength: note.bytes.byteLength,
      },
    );
    node.modifiedAt = note.modifiedAt ?? capturedAt;
    manifest.nodes[note.id] = node;
    addChild(manifest, parentId, note.id);
    result.nodeIds.push(note.id);
    result.versionsRecovered++;
  }
  return result;
}
