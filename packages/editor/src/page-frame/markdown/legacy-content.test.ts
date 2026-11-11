import { describe, expect, it } from 'vitest';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import * as Y from 'yjs';
import { schema } from '../pm/schema';
import {
  CONTENT_FORMAT_KEY,
  migrateLegacyPageFrameContent,
  PAGE_FRAME_CONTENT_FORMAT,
  readPageFrameDoc,
} from './legacy-content';
import { serializeDocToMarkdown } from './serializer';

function frameWith(...lines: string[]) {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment('frame');
  const yMap = ydoc.getMap<unknown>('props');
  prosemirrorToYXmlFragment(
    schema.nodes.doc.create(
      null,
      lines.map((line) =>
        schema.nodes.paragraph.create(null, schema.text(line)),
      ),
    ),
    fragment,
  );
  return { fragment, yMap };
}

describe('migrateLegacyPageFrameContent', () => {
  it('converts literal emphasis and sole-image paragraphs in place', () => {
    const { fragment, yMap } = frameWith('a **b** c', '![alt](/pics/cat.png)');

    migrateLegacyPageFrameContent(yMap, fragment);

    const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    expect(doc.child(0).textContent).toBe('a b c');
    expect(doc.child(1).type.name).toBe('figure');
    expect(doc.child(1).attrs.src).toBe('/pics/cat.png');
    expect(yMap.get(CONTENT_FORMAT_KEY)).toBe(PAGE_FRAME_CONTENT_FORMAT);
  });

  it('leaves literal asterisks alone once a frame is at the current format', () => {
    const { fragment, yMap } = frameWith('2 *literal* stars');
    yMap.set(CONTENT_FORMAT_KEY, PAGE_FRAME_CONTENT_FORMAT);

    migrateLegacyPageFrameContent(yMap, fragment);

    const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    expect(doc.textContent).toBe('2 *literal* stars');
  });

  it('does not mark an empty frame, whose content may not have synced', () => {
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap<unknown>('props');

    migrateLegacyPageFrameContent(yMap, ydoc.getXmlFragment('frame'));

    expect(yMap.has(CONTENT_FORMAT_KEY)).toBe(false);
  });

  it('exports an unopened legacy frame as real markdown without writing to it', () => {
    const { fragment, yMap } = frameWith('a **b** c');

    const markdown = serializeDocToMarkdown(readPageFrameDoc(yMap, fragment));

    expect(markdown).toBe('a **b** c\n');
    expect(yMap.has(CONTENT_FORMAT_KEY)).toBe(false);
  });

  it('keeps asterisks inside inline code', () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment('frame');
    const yMap = ydoc.getMap<unknown>('props');
    const code = [schema.marks.code.create()];
    prosemirrorToYXmlFragment(
      schema.nodes.doc.create(
        null,
        schema.nodes.paragraph.create(null, [
          schema.text('**kwargs', code),
          schema.text(' and '),
          schema.text('**opts', code),
        ]),
      ),
      fragment,
    );

    migrateLegacyPageFrameContent(yMap, fragment);

    const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    expect(doc.textContent).toBe('**kwargs and **opts');
  });
});
