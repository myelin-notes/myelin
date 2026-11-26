import * as Y from 'yjs';
import { ElementType } from '@myelin/editor/elements/element-type';
import { getPlatform } from '@myelin/editor/platform';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import type { NativeRepository, VFSFileNode, VFSNodeId } from '@/lib/sync';
import { isTemplatesRoot } from '@/lib/sync/repo/shared';
import { noteJson } from '@/pages/library/export/workspace-json';
import { createBlankCanvasFile } from './create';
import { renderTemplateFields } from './name-pattern';

export const TEMPLATE_EXTENSION = '.myelin-template';

/** Falls back to a blank canvas when `templateId` is null or no longer exists. */
export async function createCanvasFromTemplate(
  repository: NativeRepository,
  name: string,
  parentId: VFSNodeId | null,
  templateId: VFSNodeId | null,
): Promise<VFSNodeId> {
  const bytes = templateId ? await repository.readFileBytes(templateId) : null;
  if (!bytes) {
    return createBlankCanvasFile(repository, name, parentId);
  }
  const id = await repository.createFile(name, 'mcanvas', parentId, bytes);
  const tags = (await repository.getNode(templateId!))?.tags ?? [];
  if (tags.length > 0) {
    await repository.setTags(id, tags);
  }
  return id;
}

// Element fields holding user-visible text: text boxes (`text`, plus `richText` PM JSON) and flags.
const FIELD_KEYS = new Set(['text', 'label']);

function fillJson(value: unknown, fill: (text: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => fillJson(item, fill));
  }
  // Plain objects only: binary fields and nested Y types stay untouched.
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === 'string' && FIELD_KEYS.has(key)
          ? fill(item)
          : fillJson(item, fill),
      ]),
    );
  }
  return value;
}

function fillXmlText(text: Y.XmlText, fill: (text: string) => string): void {
  const runs: { index: number; insert: string; attributes?: object }[] = [];
  let index = 0;
  for (const op of text.toDelta()) {
    if (typeof op.insert === 'string') {
      runs.push({ index, insert: op.insert, attributes: op.attributes });
      index += op.insert.length;
    } else {
      index += 1;
    }
  }
  // Back to front so earlier offsets survive length changes.
  for (const run of runs.reverse()) {
    const filled = fill(run.insert);
    if (filled !== run.insert) {
      text.delete(run.index, run.insert.length);
      text.insert(run.index, filled, run.attributes ?? {});
    }
  }
}

function fillXml(
  node: Y.XmlFragment | Y.XmlElement,
  fill: (text: string) => string,
): void {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) {
      fillXmlText(child, fill);
    } else if (child instanceof Y.XmlElement) {
      fillXml(child, fill);
    }
  }
}

/**
 * Replaces `{title}`, `{date}` etc. in every text element with the note's current name and
 * `date`. Runs once the name is final, so a canvas created from a template keeps its tokens until
 * then. A no-op inside the templates folder, where tokens must survive.
 */
export async function fillTemplateFields(
  repository: NativeRepository,
  nodeId: VFSNodeId,
  locale: string,
  date = new Date(),
): Promise<void> {
  const node = await repository.getNode(nodeId);
  if (node?.type !== 'file' || node.fileType !== 'mcanvas') {
    return;
  }
  const parent = node.parentId ? await repository.getNode(node.parentId) : null;
  if (isTemplatesRoot(parent)) {
    return;
  }
  const snapshot = await repository.loadDocument(nodeId);
  if (!snapshot.update) {
    return;
  }
  const ydoc = YDocManager.fromUpdate(snapshot.update);
  try {
    const fill = (text: string) =>
      renderTemplateFields(text, node.name, date, locale);
    const before = Y.encodeStateVector(ydoc.doc);
    ydoc.transact(() => {
      for (const yMap of ydoc.elements) {
        for (const [key, value] of [...yMap.entries()]) {
          const filled =
            typeof value === 'string'
              ? FIELD_KEYS.has(key)
                ? fill(value)
                : value
              : fillJson(value, fill);
          if (JSON.stringify(filled) !== JSON.stringify(value)) {
            yMap.set(key, filled);
          }
        }
        const uuid = yMap.get('uuid');
        if (
          yMap.get('type') === ElementType.PAGE_FRAME &&
          typeof uuid === 'string'
        ) {
          fillXml(ydoc.getXmlFragment(uuid), fill);
        }
      }
    });
    const update = Y.encodeStateAsUpdate(ydoc.doc, before);
    // An empty update is 2 bytes: no structs, empty delete set.
    if (update.byteLength > 2) {
      await repository.persistDocumentUpdate(nodeId, update);
    }
  } finally {
    ydoc.doc.destroy();
  }
}

export async function saveAsTemplate(
  repository: NativeRepository,
  canvas: VFSFileNode,
): Promise<void> {
  const bytes = await repository.readFileBytes(canvas.id);
  if (!bytes) {
    throw new Error(`Canvas has no stored content: ${canvas.id}`);
  }
  const rootId = await repository.ensureTemplatesRoot();
  const name = await repository.getUniqueFileName(canvas.name, rootId);
  await repository.createFile(name, 'mcanvas', rootId, bytes);
}

export async function exportTemplate(
  repository: NativeRepository,
  template: VFSFileNode,
): Promise<void> {
  await getPlatform().saveFile({
    suggestedName: `${template.name}${TEMPLATE_EXTENSION}`,
    filter: { name: 'Myelin template', extensions: ['myelin-template'] },
    data: noteJson(repository, template),
  });
}
