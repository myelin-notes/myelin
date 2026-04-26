import { EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { schema } from './schema';
import { createTableNode } from './table-commands';
import { PageFrameTableNodeView } from './table-node-view';

class MockElement extends EventTarget {
  public className = '';
  public textContent: string | null = null;
  public tabIndex = 0;
  public type = '';
  public readonly style: Record<string, string> = {};
  public readonly children: MockElement[] = [];
  private readonly attributes = new Map<string, string>();

  appendChild(child: MockElement): MockElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

function createTableState() {
  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [createTableNode(schema, 2, 2)]),
  });
}

function createMockView(state: EditorState) {
  let dispatchedTransaction: Transaction | null = null;

  return {
    view: {
      state,
      dispatch: vi.fn((tr: Transaction) => {
        dispatchedTransaction = tr;
      }),
      focus: vi.fn(),
    } as unknown as EditorView,
    readDispatchedTransaction: () => dispatchedTransaction,
  };
}

function createHandle(options: { kind: 'column' | 'row'; index: number }) {
  const state = createTableState();
  const { view, readDispatchedTransaction } = createMockView(state);
  const target = (
    PageFrameTableNodeView.prototype as unknown as {
      createHandle: (options: {
        kind: 'column' | 'row';
        index: number;
        targetLeft: number;
        targetTop: number;
        targetWidth: number;
        targetHeight: number;
        bubbleLeft: number;
        bubbleTop: number;
      }) => MockElement;
    }
  ).createHandle.call(
    {
      view,
      readTablePos: () => 0,
    },
    {
      ...options,
      targetLeft: 10,
      targetTop: 20,
      targetWidth: 30,
      targetHeight: 40,
      bubbleLeft: 15,
      bubbleTop: 25,
    },
  );

  return {
    state,
    target,
    button: target.children[0],
    view,
    readDispatchedTransaction,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('table node view handles', () => {
  it('does not dispatch when the hover strip itself is clicked', () => {
    vi.stubGlobal('document', {
      createElement: () => new MockElement(),
    } as unknown as Document);

    const { target, view, readDispatchedTransaction } = createHandle({
      kind: 'row',
      index: 0,
    });

    target.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.focus).not.toHaveBeenCalled();
    expect(readDispatchedTransaction()).toBeNull();
  });

  it('dispatches insertion when the add button is clicked', () => {
    vi.stubGlobal('document', {
      createElement: () => new MockElement(),
    } as unknown as Document);

    const { state, button, view, readDispatchedTransaction } = createHandle({
      kind: 'row',
      index: 0,
    });

    button.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(view.focus).toHaveBeenCalledTimes(1);

    const transaction = readDispatchedTransaction();
    expect(transaction).not.toBeNull();

    const nextState = state.apply(transaction!);
    expect(nextState.doc.firstChild?.childCount).toBe(3);
  });
});
