import { describe, expect, it } from 'vitest';
import { notebookToMarkdown } from './notebook';

const notebook = (cells: unknown[], metadata: unknown = {}) =>
  JSON.stringify({ cells, metadata, nbformat: 4, nbformat_minor: 5 });

const PYTHON = { language_info: { name: 'Python' } };

describe('notebookToMarkdown', () => {
  it('keeps markdown cells as text and fences code cells', () => {
    const json = notebook(
      [
        { cell_type: 'markdown', source: ['# Title\n', '\n', 'Some prose.'] },
        { cell_type: 'code', source: ['print(1)\n', 'print(2)'] },
      ],
      PYTHON,
    );
    expect(notebookToMarkdown(json)).toBe(
      '# Title\n\nSome prose.\n\n```python\nprint(1)\nprint(2)\n```',
    );
  });

  it('accepts a plain string source', () => {
    expect(
      notebookToMarkdown(notebook([{ cell_type: 'code', source: 'x = 1' }])),
    ).toBe('```\nx = 1\n```');
  });

  it('falls back to the kernelspec language', () => {
    const json = notebook([{ cell_type: 'code', source: 'puts 1' }], {
      kernelspec: { language: 'ruby', name: 'ruby3' },
    });
    expect(notebookToMarkdown(json)).toBe('```ruby\nputs 1\n```');
  });

  // Without a longer fence the cell's own fence would close the block early.
  it('lengthens the fence past any backtick run in the code', () => {
    const json = notebook(
      [{ cell_type: 'code', source: 'x = """```\nnested\n```"""' }],
      PYTHON,
    );
    expect(notebookToMarkdown(json)).toBe(
      '````python\nx = """```\nnested\n```"""\n````',
    );
  });

  it('drops empty cells rather than importing blank paragraphs', () => {
    const json = notebook(
      [
        { cell_type: 'code', source: [] },
        { cell_type: 'markdown', source: ['   \n'] },
        { cell_type: 'markdown', source: 'kept' },
      ],
      PYTHON,
    );
    expect(notebookToMarkdown(json)).toBe('kept');
  });

  it('treats raw cells as text', () => {
    const json = notebook([{ cell_type: 'raw', source: 'raw text' }], PYTHON);
    expect(notebookToMarkdown(json)).toBe('raw text');
  });

  it('ignores saved outputs', () => {
    const json = notebook(
      [
        {
          cell_type: 'code',
          source: 'print(1)',
          execution_count: 3,
          outputs: [{ output_type: 'stream', text: ['1\n'] }],
        },
      ],
      PYTHON,
    );
    expect(notebookToMarkdown(json)).toBe('```python\nprint(1)\n```');
  });

  it('rejects files that are not nbformat 4 notebooks', () => {
    expect(() => notebookToMarkdown('not json')).toThrow(/not valid JSON/);
    expect(() => notebookToMarkdown('{"worksheets":[]}')).toThrow(/no "cells"/);
  });
});
