import { describe, expect, it, vi } from 'vitest';
import { ElementType } from '@myelin/editor/elements/element-type';
import en from '@myelin/editor/i18n/messages/en';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import type { Repository, VFSNodeId } from '@/lib/sync';
import { createStarterCanvasFile } from './starter-canvas';

function buildCanvas() {
  const createFile = vi.fn<Repository['createFile']>(
    async () => 'note-1' as VFSNodeId,
  );
  const repository = { createFile } as unknown as Repository;
  return { createFile, repository };
}

async function encodedCanvas(): Promise<YDocManager> {
  const { createFile, repository } = buildCanvas();
  await createStarterCanvasFile(repository, 'Getting started', en);
  const bytes = createFile.mock.calls[0]?.[3];
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Expected encoded canvas bytes');
  }
  return YDocManager.fromUpdate(bytes);
}

describe('createStarterCanvasFile', () => {
  it('lays out a page frame plus free-floating text and LaTeX', async () => {
    const ydoc = await encodedCanvas();
    const types = ydoc.elements
      .toArray()
      .map((element) => element.get('type') as ElementType);

    expect(types.filter((t) => t === ElementType.PAGE_FRAME)).toHaveLength(1);
    expect(types.filter((t) => t === ElementType.LATEX)).toHaveLength(1);
    expect(
      types.filter((t) => t === ElementType.TEXT).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('keeps the canvas elements clear of the page', async () => {
    const ydoc = await encodedCanvas();
    const frame = ydoc.elements
      .toArray()
      .find((element) => element.get('type') === ElementType.PAGE_FRAME);
    const frameRight =
      (frame?.get('offsetX') as number) + (frame?.get('pageWidth') as number);

    for (const element of ydoc.elements.toArray()) {
      if (element.get('type') === ElementType.PAGE_FRAME) {
        continue;
      }
      expect(element.get('offsetX') as number).toBeGreaterThan(frameRight);
    }
  });

  it('fills the page frame with the blocks the onboarding step promises', async () => {
    const ydoc = await encodedCanvas();
    const frame = ydoc.elements
      .toArray()
      .find((element) => element.get('type') === ElementType.PAGE_FRAME);
    const xml = ydoc.getXmlFragment(frame?.get('uuid') as string).toString();

    expect(xml).toContain('<codeblock>');
    expect(xml).toContain('```mermaid');
    expect(xml).toContain('<mathblock>');
    expect(xml).toContain('<table_row>');
    expect(xml).toContain('<checklistitem');
    expect(xml).toContain('[!tip]');
  });

  it('keeps note-link syntax out of the page', async () => {
    // `[[…]]` inside a page frame wedges the editor: the note-link resolver
    // view re-dispatches forever when the link never resolves to a node. The
    // starter page describes the syntax in prose instead.
    const ydoc = await encodedCanvas();
    const frame = ydoc.elements
      .toArray()
      .find((element) => element.get('type') === ElementType.PAGE_FRAME);
    const xml = ydoc.getXmlFragment(frame?.get('uuid') as string).toString();

    expect(xml).not.toContain('[[');
  });
});
