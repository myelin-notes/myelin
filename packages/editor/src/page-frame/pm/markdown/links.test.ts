import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '../../../platform';
import { createFakePlatform } from '../../../test/fake-platform';
import { parseMarkdownToDoc } from '../../markdown/parser';
import { schema } from '../schema';
import {
  buildNormalizedLinkTransaction,
  expandMarkdownLinkCommand,
  linkMarkdownPlugin,
} from './links';

const openExternal = vi.fn(async () => {});

beforeEach(() => {
  openExternal.mockClear();
  setPlatform(createFakePlatform({ openExternal }));
});

function createEditorState(doc = schema.nodes.doc.createAndFill()!) {
  return EditorState.create({
    schema,
    doc,
    plugins: [linkMarkdownPlugin(schema)],
  });
}

describe('linkMarkdownPlugin', () => {
  it('normalizes raw markdown links into link marks when typing completes', () => {
    const state = createEditorState();
    const result = state.applyTransaction(
      state.tr.insertText('[Alpha](https://example.com)', 1),
    );

    expect(result.state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Alpha',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com',
                    title: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('keeps a completed raw link as markdown while the caret is still inside it', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('[Alpha](https://example.com)'),
      ]),
    ]);
    const baseState = createEditorState(doc);
    const state = baseState.apply(
      baseState.tr.setSelection(TextSelection.create(baseState.doc, 4)),
    );

    expect(buildNormalizedLinkTransaction(state, schema)).toBeNull();
  });

  it('normalizes a completed raw link once the caret moves past it', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('[Alpha](https://example.com)'),
      ]),
    ]);
    const baseState = createEditorState(doc);
    const state = baseState.apply(
      baseState.tr.setSelection(TextSelection.create(baseState.doc, 29)),
    );
    const tr = buildNormalizedLinkTransaction(state, schema);

    expect(tr).not.toBeNull();
    expect(state.apply(tr!).doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Alpha',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com',
                    title: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('opens rendered links on cmd-click', () => {
    const plugin = linkMarkdownPlugin(schema);
    const handleClick = plugin.props.handleClick;
    const preventDefault = vi.fn();
    const target = {
      closest(selector: string) {
        return selector === 'a[href]' ? this : null;
      },
      getAttribute(name: string) {
        return name === 'href' ? 'https://example.com' : null;
      },
    };
    const event = {
      metaKey: true,
      ctrlKey: false,
      preventDefault,
      target,
    } as unknown as MouseEvent;

    expect(handleClick?.call(plugin, {} as EditorView, 1, event)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('normalizes bare domains before opening them on cmd-click', () => {
    const plugin = linkMarkdownPlugin(schema);
    const handleClick = plugin.props.handleClick;
    const preventDefault = vi.fn();
    const target = {
      closest(selector: string) {
        return selector === 'a[href]' ? this : null;
      },
      getAttribute(name: string) {
        return name === 'href' ? 'example.com/docs' : null;
      },
    };
    const event = {
      metaKey: true,
      ctrlKey: false,
      preventDefault,
      target,
    } as unknown as MouseEvent;

    expect(handleClick?.call(plugin, {} as EditorView, 1, event)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('normalizes localhost links to http before opening them on ctrl-click', () => {
    const plugin = linkMarkdownPlugin(schema);
    const handleClick = plugin.props.handleClick;
    const preventDefault = vi.fn();
    const target = {
      closest(selector: string) {
        return selector === 'a[href]' ? this : null;
      },
      getAttribute(name: string) {
        return name === 'href' ? 'localhost:3000/path' : null;
      },
    };
    const event = {
      metaKey: false,
      ctrlKey: true,
      preventDefault,
      target,
    } as unknown as MouseEvent;

    expect(handleClick?.call(plugin, {} as EditorView, 1, event)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('http://localhost:3000/path');
  });
});

describe('expandMarkdownLinkCommand', () => {
  it('turns a rendered link back into raw markdown and keeps the caret inside the label', () => {
    const doc = parseMarkdownToDoc('[Alpha](https://example.com)', schema);
    const baseState = EditorState.create({
      schema,
      doc,
    });
    const state = baseState.apply(
      baseState.tr.setSelection(TextSelection.create(baseState.doc, 3)),
    );
    let nextState = state;

    const handled = expandMarkdownLinkCommand(state, (tr) => {
      nextState = state.apply(tr);
    });

    expect(handled).toBe(true);
    expect(nextState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '[Alpha](https://example.com)',
            },
          ],
        },
      ],
    });
    expect(nextState.selection.from).toBe(4);
    expect(nextState.selection.to).toBe(4);
  });
});
