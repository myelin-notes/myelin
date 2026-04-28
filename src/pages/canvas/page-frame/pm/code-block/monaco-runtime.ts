import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/php/php.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker: (_moduleId: string, label: string) => Worker;
    };
  }
}

let configured = false;

function configureMonaco(): void {
  if (configured) {
    return;
  }

  window.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === 'json') {
        return new jsonWorker();
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker();
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker();
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    },
  };

  monaco.editor.defineTheme('myelin-code-block', {
    base: 'vs',
    inherit: false,
    rules: [
      { token: '', foreground: '1F2328' },
      { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'cf222e' },
      { token: 'keyword.control', foreground: 'cf222e' },
      { token: 'keyword.operator', foreground: '1F2328' },
      { token: 'string', foreground: '0a3069' },
      { token: 'string.escape', foreground: '0550ae' },
      { token: 'number', foreground: '0550ae' },
      { token: 'number.float', foreground: '0550ae' },
      { token: 'number.hex', foreground: '0550ae' },
      { token: 'type', foreground: '0550ae' },
      { token: 'type.identifier', foreground: '953800' },
      { token: 'identifier', foreground: '1F2328' },
      { token: 'variable', foreground: '953800' },
      { token: 'constant', foreground: '0550ae' },
      { token: 'function', foreground: '8250df' },
      { token: 'annotation', foreground: '8250df' },
      { token: 'operator', foreground: '1F2328' },
      { token: 'delimiter', foreground: '1F2328' },
      { token: 'delimiter.bracket', foreground: '1F2328' },
      { token: 'delimiter.parenthesis', foreground: '1F2328' },
      { token: 'tag', foreground: '116329' },
      { token: 'metatag', foreground: 'cf222e' },
      { token: 'attribute.name', foreground: '0550ae' },
      { token: 'attribute.value', foreground: '0a3069' },
      { token: 'regexp', foreground: '116329' },
    ],
    colors: {
      'editor.background': '#00000000',
      'editor.foreground': '#1F2328',
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#0969DA26',
      'editor.inactiveSelectionBackground': '#0969DA15',
      'editorCursor.foreground': '#1F2328',
      'editorIndentGuide.background1': '#d8dee4',
      'editorLineNumber.foreground': '#8c959f',
      'editorLineNumber.activeForeground': '#1F2328',
      'editorWhitespace.foreground': '#d1d9e0',
      'editorBracketMatch.background': '#0969DA1a',
      'editorBracketMatch.border': '#00000000',
    },
  });

  configured = true;
}

export type MonacoApi = typeof monaco;

export function getMonaco(): MonacoApi {
  configureMonaco();
  return monaco;
}
