import { markdown } from '@codemirror/lang-markdown';
import {
  HighlightStyle,
  LanguageDescription,
  type LanguageSupport,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/**
 * Code-block documents are literal markdown fenced code blocks (the ``` fence
 * lines are part of the text). Parsing them AS markdown keeps the fences out
 * of the inner language's parse — a bare ``` would otherwise e.g. open an
 * unterminated template literal in JS/TS — and mounts the right grammar for
 * the interior based on the fence info string, lazily via language-data.
 *
 * Fence tokens are resolved against language names/aliases (`python`, `js`,
 * `c#`), falling back to file extensions (`py`, `rs`, `htm`, `md`).
 */
export function codeBlockLanguage(): LanguageSupport {
  return markdown({
    addKeymap: false,
    codeLanguages: (info: string) => {
      const normalized = info.toLowerCase();
      return (
        LanguageDescription.matchLanguageName(languages, normalized, true) ??
        LanguageDescription.matchFilename(languages, `x.${normalized}`)
      );
    },
  });
}

/** GitHub-light token palette, mirrored from the previous Monaco theme. */
const codeBlockHighlightStyle = HighlightStyle.define([
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: '#6e7781',
    fontStyle: 'italic',
  },
  {
    tag: [
      t.keyword,
      t.modifier,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
    ],
    color: '#cf222e',
  },
  { tag: [t.string, t.special(t.string), t.docString], color: '#0a3069' },
  { tag: [t.escape, t.character], color: '#0550ae' },
  {
    tag: [t.number, t.integer, t.float, t.bool, t.atom, t.null],
    color: '#0550ae',
  },
  {
    tag: [t.constant(t.variableName), t.standard(t.variableName)],
    color: '#0550ae',
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.typeOperator],
    color: '#953800',
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.definition(t.function(t.variableName)),
      t.macroName,
      t.labelName,
    ],
    color: '#8250df',
  },
  { tag: [t.tagName], color: '#116329' },
  { tag: [t.attributeName], color: '#0550ae' },
  { tag: [t.attributeValue], color: '#0a3069' },
  { tag: [t.meta, t.processingInstruction], color: '#cf222e' },
  { tag: [t.regexp], color: '#116329' },
  { tag: [t.heading], fontWeight: 'bold' },
  { tag: [t.strong], fontWeight: 'bold' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], textDecoration: 'underline' },
]);

export { codeBlockHighlightStyle };

/** Editor chrome: transparent surface, GitHub-light gutter and selection. */
export const codeBlockEditorTheme = EditorView.theme({
  // The editor grows to fit its content; syncLayout sets max-height so it caps
  // at the page-frame content height and scrolls past that.
  '&': {
    color: '#1F2328',
    backgroundColor: 'transparent',
    fontSize: '14px',
  },
  '.cm-scroller': {
    fontFamily:
      '"SFMono-Regular", "SF Mono", ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
    lineHeight: '1.5',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '14px 0',
    caretColor: '#1F2328',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: '#8c959f',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '3ch',
    padding: '0 6px 0 12px',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#1F2328',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':
    {
      backgroundColor: '#0969DA26',
    },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
});
