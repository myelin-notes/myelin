import type { Node as PMNode } from 'prosemirror-model';
import {
  EditorState,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { schema } from '../schema';
import { mathPreviewPlugin } from './plugin';
import { moveVerticallyFromLeadingMath } from './vertical-move';

const LINE_HEIGHT = 20;

function bullet(...content: (string | PMNode)[]): PMNode {
  return schema.nodes.bulletListItem.create(
    null,
    content.map((part) =>
      typeof part === 'string' ? schema.text(part) : part,
    ),
  );
}

// `lineTop` maps a doc position to the top of the visual line it lays out on.
function createView(
  blocks: PMNode[],
  anchor: number,
  lineTop: (pos: number) => number = () => 0,
  head = anchor,
) {
  const doc = schema.nodes.doc.create(null, blocks);
  const view = {
    state: EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, anchor, head),
    }),
    dispatch(tr: Transaction) {
      view.state = view.state.apply(tr);
    },
    coordsAtPos(pos: number) {
      const top = lineTop(pos);
      return { left: 0, right: 0, top, bottom: top + LINE_HEIGHT };
    },
  };
  return view;
}

type StubView = ReturnType<typeof createView>;

function move(view: StubView, dir: -1 | 1, extend = false): boolean {
  return moveVerticallyFromLeadingMath(
    view as unknown as EditorView,
    dir,
    extend,
  );
}

function pressKey(view: StubView, key: string, shiftKey = false): boolean {
  const handleKeyDown = mathPreviewPlugin().props.handleKeyDown;
  return !!handleKeyDown?.call(
    // biome-ignore lint/suspicious/noExplicitAny: plugin `this` is unused
    {} as any,
    view as unknown as EditorView,
    {
      key,
      shiftKey,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
    } as KeyboardEvent,
  );
}

describe('moveVerticallyFromLeadingMath', () => {
  it('moves down to the start of the next list item', () => {
    const view = createView([bullet('$x$'), bullet('another point')], 1);

    expect(move(view, 1)).toBe(true);
    expect(view.state.selection.head).toBe(6);
  });

  it('moves down to the next visual line of a wrapped block', () => {
    const view = createView([bullet('$x$ wraps here')], 1, (pos) =>
      pos >= 9 ? LINE_HEIGHT : 0,
    );

    expect(move(view, 1)).toBe(true);
    expect(view.state.selection.head).toBe(9);
  });

  it('follows a block that continues at the top of the next column', () => {
    const view = createView(
      [bullet('$x$ continues'), bullet('next')],
      1,
      (pos) => (pos >= 9 ? 0 : 400),
    );

    expect(move(view, 1)).toBe(true);
    expect(view.state.selection.head).toBe(9);
  });

  it('moves up to the start of the last visual line of the previous block', () => {
    // `first second` spans 1..13 and wraps before `second` (pos 7); `$x$` starts at 15.
    const view = createView(
      [bullet('first second'), bullet('$x$')],
      15,
      (pos) => (pos >= 7 && pos <= 13 ? LINE_HEIGHT : 0),
    );

    expect(move(view, -1)).toBe(true);
    expect(view.state.selection.head).toBe(7);
  });

  it('moves up across a hard break within the block', () => {
    // `ab` at 1..3, the hard break at 3..4, `$x$` from 4.
    const view = createView(
      [bullet('ab', schema.nodes.hardBreak.create(), '$x$')],
      4,
      (pos) => (pos >= 4 ? LINE_HEIGHT : 0),
    );

    expect(move(view, -1)).toBe(true);
    expect(view.state.selection.head).toBe(1);
  });

  it('keeps the anchor when extending the selection', () => {
    const view = createView([bullet('$x$'), bullet('another point')], 1);

    expect(move(view, 1, true)).toBe(true);
    expect(view.state.selection).toMatchObject({ anchor: 1, head: 6 });
  });

  it('enters a math block at its edge', () => {
    const mathBlock = schema.nodes.mathBlock.create(null, schema.text('y = 1'));
    const view = createView([mathBlock, bullet('$x$')], 8, (pos) =>
      pos < 7 ? 0 : LINE_HEIGHT,
    );

    expect(move(view, -1)).toBe(true);
    expect(view.state.selection.head).toBe(6);
  });
});

describe('mathPreviewPlugin vertical arrows', () => {
  it('handles a formula at the start of a textblock', () => {
    const view = createView([bullet('$x$'), bullet('next')], 1);
    expect(pressKey(view, 'ArrowDown')).toBe(true);
  });

  it('handles a formula right after a hard break', () => {
    const view = createView(
      [bullet('ab', schema.nodes.hardBreak.create(), '$x$'), bullet('next')],
      4,
      (pos) => (pos >= 4 ? LINE_HEIGHT : 0),
    );
    expect(pressKey(view, 'ArrowDown')).toBe(true);
    expect(view.state.selection.head).toBe(9);
  });

  it('handles shift when the selection head sits before the formula', () => {
    const view = createView(
      [bullet('above'), bullet('$x$'), bullet('next')],
      3,
      (pos) => (pos >= 8 ? LINE_HEIGHT : 0),
      8,
    );
    expect(pressKey(view, 'ArrowDown', true)).toBe(true);
    expect(view.state.selection).toMatchObject({ anchor: 3, head: 13 });
  });

  it('leaves a formula after text on its line to native movement', () => {
    const view = createView([bullet('ab $x$')], 4);
    expect(pressKey(view, 'ArrowDown')).toBe(false);
  });

  it('leaves a selection that reveals the formula source to native movement', () => {
    const view = createView([bullet('$x$ b')], 6, () => 0, 1);
    expect(pressKey(view, 'ArrowUp', true)).toBe(false);
  });
});
