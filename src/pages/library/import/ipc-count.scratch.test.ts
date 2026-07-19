import { strToU8 } from 'fflate';
import { describe, it, vi } from 'vitest';
import { ElementType } from '@myelin/editor/elements/element-type';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import * as fs from '@tauri-apps/plugin-fs';
import { LocalRepository } from '@/lib/sync/repo/local';
import { serializeNoteElements } from '@/pages/library/export/workspace-json';
import { NOTE_JSON_VERSION } from '@/pages/library/export/workspace-json-format';
import { resetRepositoryTestDoubles } from '@/test/repository-test-utils';
import { importWorkspaceJson, scanArchive } from './workspace-json';

const NOTE_COUNT = 20;

function buildNoteJson(i: number): string {
  const ydoc = new YDocManager();
  ydoc.createElementMap(ElementType.STROKE, `stroke-${i}`, {
    offsetX: 5,
    offsetY: 6,
    scaleX: 1,
    scaleY: 1,
    color: '#ff0000',
    size: 4,
    hasPressure: false,
    points: [0, 0, 0.5, 10, 12, 0.7],
  });
  return JSON.stringify({
    version: NOTE_JSON_VERSION,
    name: `Note ${i}`,
    fileType: 'mcanvas',
    tags: ['a'],
    createdAt: 1,
    modifiedAt: 2,
    elements: serializeNoteElements(ydoc),
  });
}

describe('import IPC cost', () => {
  it('counts plugin-fs calls for a synthetic import', async () => {
    resetRepositoryTestDoubles();

    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < NOTE_COUNT; i++) {
      entries[`Workspace/Note ${i}.json`] = strToU8(buildNoteJson(i));
    }
    const scanned = scanArchive(entries, 'Workspace');

    const repository = new LocalRepository('repositories/ipc-count');
    await repository.initialize();

    const counters: Record<string, number> = {};
    for (const name of [
      'exists',
      'readFile',
      'readTextFile',
      'writeFile',
      'writeTextFile',
      'open',
      'mkdir',
    ] as const) {
      const original = fs[name] as (...args: unknown[]) => unknown;
      vi.spyOn(fs, name).mockImplementation((...args: unknown[]) => {
        counters[name] = (counters[name] ?? 0) + 1;
        return original(...args);
      });
    }

    const result = await importWorkspaceJson({
      repository,
      parentId: null,
      zipPath: 'Workspace.zip',
      scanned,
    });

    const total = Object.values(counters).reduce((a, b) => a + b, 0);
    console.log('\n=== IPC COUNT ===');
    console.log('notes imported:', result.notesImported, '/', NOTE_COUNT);
    console.log(counters);
    console.log('total fs calls:', total);
    console.log('per note:', (total / NOTE_COUNT).toFixed(2));
    console.log('=================\n');

    vi.restoreAllMocks();
  });
});
