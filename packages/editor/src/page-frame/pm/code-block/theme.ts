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

/**
 * Token palette sourced from CSS theme tokens (--syntax-*), so it tracks
 * light/dark automatically — CodeMirror accepts `var(...)` color strings and
 * the highlight style needs no reconfiguration on theme change.
 */
const codeBlockHighlightStyle = HighlightStyle.define([
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: 'var(--syntax-comment)',
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
    color: 'var(--syntax-keyword)',
  },
  {
    tag: [t.string, t.special(t.string), t.docString],
    color: 'var(--syntax-string)',
  },
  { tag: [t.escape, t.character], color: 'var(--syntax-constant)' },
  {
    tag: [t.number, t.integer, t.float, t.bool, t.atom, t.null],
    color: 'var(--syntax-constant)',
  },
  {
    tag: [t.constant(t.variableName), t.standard(t.variableName)],
    color: 'var(--syntax-constant)',
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.typeOperator],
    color: 'var(--syntax-type)',
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.definition(t.function(t.variableName)),
      t.macroName,
      t.labelName,
    ],
    color: 'var(--syntax-function)',
  },
  { tag: [t.tagName], color: 'var(--syntax-tag)' },
  { tag: [t.attributeName], color: 'var(--syntax-constant)' },
  { tag: [t.attributeValue], color: 'var(--syntax-string)' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--syntax-keyword)' },
  { tag: [t.regexp], color: 'var(--syntax-tag)' },
  { tag: [t.heading], fontWeight: 'bold' },
  { tag: [t.strong], fontWeight: 'bold' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], textDecoration: 'underline' },
]);

export { codeBlockHighlightStyle };

/** Editor chrome: transparent surface, themed gutter and selection. */
export const codeBlockEditorTheme = EditorView.theme({
  // The editor grows to fit its content; the shared .pm-page-capped CSS rule
  // caps it at the page-frame content height and it scrolls past that.
  '&': {
    color: 'var(--text-primary)',
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
    caretColor: 'var(--text-primary)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
  },
  // No minWidth: `ch` resolves inconsistently under page-frame scaling, and
  // CodeMirror already sizes the gutter to the widest line number via its
  // hidden spacer element.
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '1ch',
    padding: '0 6px 0 18px',
  },
  // Native selection/caret (no drawSelection() extension installed).
  '::selection': {
    backgroundColor: 'var(--editor-selection)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
});
