import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { type Diagnostic, linter } from '@codemirror/lint';
import { type Extension, Prec } from '@codemirror/state';
import { EditorView, type KeyBinding, keymap } from '@codemirror/view';
import { codeBlockHighlightStyle } from '../code-block/theme';
import {
  NestedEditor,
  type NestedEditorKeyCallbacks,
  nestedEditorKeyBindings,
} from '../nested-editor/editor';
import { parseMathMarkdown, stripMathDelimiters } from './parse-math-block';
import { mathParseError } from './render';

/**
 * The object's identity doubles as the ownership token for attach/release, so each node view must
 * keep one stable instance.
 */
export interface MathSourceEditorOwner extends NestedEditorKeyCallbacks {
  onContentChange: () => void;
  onDeleteEmptyBlock: () => boolean;
  onEnter: () => boolean;
  onSelectAll: () => boolean;
  onSelectionChange: () => void;
}

interface MathSourceEditorOwnerRef {
  current: MathSourceEditorOwner | null;
}

// Popup chrome (border, shadow, background) lives on .pm-math-block-source; the editor stays
// transparent and owns the monospace font, wrapping and the height cap.
const mathSourceEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
    maxHeight: '300px',
  },
  '.cm-scroller': {
    fontFamily:
      '"SFMono-Regular", "SF Mono", ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
    lineHeight: '1.5',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '2px 4px',
    caretColor: 'var(--text-primary)',
  },
  '::selection': {
    backgroundColor: 'var(--editor-selection)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  // Restyled from CodeMirror's defaults to match components/ui/tooltip.tsx. The lint ul nests
  // inside the generic .cm-tooltip wrapper, and lint hovers are the only tooltips here, so style
  // the wrapper directly.
  '.cm-tooltip': {
    border: 'none',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--foreground)',
    maxWidth: '320px',
    overflow: 'hidden',
  },
  '.cm-diagnostic': {
    padding: '6px 12px',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    lineHeight: '1.4',
    color: 'var(--background)',
  },
  // Severity already lives in the squiggle; CodeMirror's default 5px #d11
  // side stripe is exactly the accent-bar pattern the app avoids.
  '.cm-diagnostic-error': {
    borderLeft: 'none',
  },
});

// The error's position is an offset into the stripped source (content lines joined by `\n`), so
// walk the content lines to map it back to a document offset.
function mathDiagnostics(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  const error = mathParseError(stripMathDelimiters(text));
  if (!error) {
    return [];
  }

  const content = parseMathMarkdown(text).lines.filter(
    (line) => line.kind === 'content',
  );

  // katex's types declare position/length as required, but ParseError leaves them undefined when
  // thrown without a token/lexer. Underline the whole stripped range rather than emit a NaN range.
  if (error.position === undefined) {
    const from = content[0]?.from ?? 0;
    const to = content[content.length - 1]?.to ?? text.length;
    return [{ from, to, severity: 'error', message: error.rawMessage }];
  }

  let from = content[content.length - 1]?.to ?? 0;
  let remaining = error.position;
  for (const line of content) {
    if (remaining <= line.text.length) {
      from = line.from + remaining;
      break;
    }
    remaining -= line.text.length + 1;
  }
  const to = Math.min(from + Math.max(error.length ?? 1, 1), text.length);
  return [{ from, to, severity: 'error', message: error.rawMessage }];
}

/**
 * The floating LaTeX source editor for math blocks. One instance is shared by all blocks and
 * re-parented into the active block's panel; `owner` is the node view borrowing it. Keys and
 * update events dispatch to the owner, which forwards into ProseMirror — the PM document stays
 * the source of truth, like CodeBlockEditor.
 */
export class MathSourceEditor extends NestedEditor {
  private readonly ownerRef: MathSourceEditorOwnerRef;

  constructor(language: Extension) {
    // The owner is swappable, but extensions are fixed at construction —
    // route them through a ref (built before super, so no `this` access).
    const ownerRef: MathSourceEditorOwnerRef = { current: null };
    const mathBindings: KeyBinding[] = [
      // Enter on the closing fence line exits the block (owner decides);
      // anywhere else falls through to the default newline.
      { key: 'Enter', run: () => ownerRef.current?.onEnter() ?? false },
      // Select only the LaTeX between the fences; falls through to the
      // default whole-document selectAll when the owner declines.
      { key: 'Mod-a', run: () => ownerRef.current?.onSelectAll() ?? false },
      // Backspace once the source is empty removes the block itself.
      {
        key: 'Backspace',
        run: (view) =>
          view.state.doc.length === 0
            ? (ownerRef.current?.onDeleteEmptyBlock() ?? false)
            : false,
      },
    ];

    super({
      extensions: [
        EditorView.lineWrapping,
        language,
        syntaxHighlighting(codeBlockHighlightStyle),
        mathSourceEditorTheme,
        linter(mathDiagnostics, { delay: 250 }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            ownerRef.current?.onContentChange();
          }
          if (update.selectionSet) {
            ownerRef.current?.onSelectionChange();
          }
        }),
        Prec.highest(
          keymap.of([
            ...mathBindings,
            ...nestedEditorKeyBindings(() => ownerRef.current),
          ]),
        ),
        keymap.of([...defaultKeymap, indentWithTab]),
      ],
    });

    this.ownerRef = ownerRef;
    this.view.dom.addEventListener('wheel', this.handleWheel);
  }

  // Steals the editor from any previous owner. The caller must suppress the resulting
  // change/selection events (its `updating` guard).
  attach(host: HTMLElement, owner: MathSourceEditorOwner, value: string): void {
    this.ownerRef.current = owner;
    if (this.view.dom.parentElement !== host) {
      host.appendChild(this.view.dom);
    }
    this.setValue(value);
  }

  /** Detach, but only if `owner` still holds the editor. */
  release(owner: MathSourceEditorOwner): void {
    if (this.ownerRef.current !== owner) {
      return;
    }
    this.ownerRef.current = null;
    this.view.dom.remove();
  }

  ownedBy(owner: MathSourceEditorOwner): boolean {
    return this.ownerRef.current === owner;
  }
}

let sharedEditor: Promise<MathSourceEditor> | null = null;

// At most one math block is editing at a time — the preview plugin only marks a block editing
// while the selection is inside it — so every block shares one CodeMirror instance.
export function getSharedMathSourceEditor(): Promise<MathSourceEditor> {
  // Don't cache a rejection: clear the slot so the next caller retries instead of re-awaiting the
  // same failed promise for the lifetime of the app.
  sharedEditor ??= createSharedMathSourceEditor().catch((error) => {
    sharedEditor = null;
    throw error;
  });
  return sharedEditor;
}

async function createSharedMathSourceEditor(): Promise<MathSourceEditor> {
  // language-data lazily resolves LaTeX to the legacy stex stream mode —
  // the same registry code blocks use for fence info strings.
  const latex = await LanguageDescription.matchLanguageName(
    languages,
    'latex',
  )?.load();
  return new MathSourceEditor(latex ?? []);
}
