import {
  HighlightStyle,
  LanguageDescription,
  type LanguageSupport,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const LANGUAGE_BY_FENCE: Record<string, string> = {
  c: 'c',
  cpp: 'cpp',
  cs: 'c#',
  css: 'css',
  go: 'go',
  htm: 'html',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  md: 'markdown',
  py: 'python',
  php: 'php',
  rs: 'rust',
  sh: 'shell',
  shell: 'shell',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'xml',
  yml: 'yaml',
};

/**
 * Resolve a fenced-code language token (e.g. `ts`, `py`, `rust`) to a
 * CodeMirror language. Grammars load on demand so they stay out of the main
 * chunk. Returns null for plaintext / unknown tokens.
 */
export function loadCodeBlockLanguage(
  language: string | null,
): Promise<LanguageSupport> | null {
  if (!language) {
    return null;
  }
  const normalized = language.toLowerCase();
  const name = LANGUAGE_BY_FENCE[normalized] ?? normalized;
  const description = LanguageDescription.matchLanguageName(
    languages,
    name,
    true,
  );
  return description ? description.load() : null;
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
