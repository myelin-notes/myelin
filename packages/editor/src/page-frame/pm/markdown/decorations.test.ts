import type { Decoration } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { schema } from '../schema';
import { buildMarkdownDecorations } from './decorations';

interface DecorationView {
  from: number;
  to: number;
  class: string;
}

function docFromText(text: string) {
  const paragraph = schema.nodes.paragraph.create(null, schema.text(text));
  return schema.nodes.doc.create(null, paragraph);
}

function docFromCodeBlock(text: string) {
  const codeBlock = schema.nodes.codeBlock.create(null, schema.text(text));
  return schema.nodes.doc.create(null, codeBlock);
}

function docFromBlockquote(text: string) {
  const content = text
    .split('\n')
    .flatMap((part, index) =>
      index === 0
        ? [schema.text(part)]
        : [schema.nodes.hardBreak.create(), schema.text(part)],
    );
  const blockquote = schema.nodes.blockquote.create(null, content);
  return schema.nodes.doc.create(null, blockquote);
}

function toDecorationViews(decorations: Decoration[]): DecorationView[] {
  return decorations
    .map((d) => ({
      from: d.from,
      to: d.to,
      class: (d as unknown as { type: { attrs: { class: string } } }).type.attrs
        .class,
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
}

function delimRangesIn(decorations: Decoration[]): Array<[number, number]> {
  return toDecorationViews(decorations)
    .filter((d) => d.class === 'pm-md-delim')
    .map((d) => [d.from, d.to]);
}

describe('buildMarkdownDecorations inline delimiters', () => {
  it('decorates an italic `*…*` span', () => {
    //   *  h  i  *
    //   1  2  3  4  5
    const decorations = buildMarkdownDecorations(docFromText('*hi*'));

    expect(toDecorationViews(decorations)).toEqual([
      { from: 1, to: 2, class: 'pm-md-delim' },
      { from: 2, to: 4, class: 'pm-md-italic' },
      { from: 4, to: 5, class: 'pm-md-delim' },
    ]);
  });

  it('decorates a bold `**…**` span', () => {
    //   *  *  h  i  *  *
    //   1  2  3  4  5  6  7
    const decorations = buildMarkdownDecorations(docFromText('**hi**'));

    expect(toDecorationViews(decorations)).toEqual([
      { from: 1, to: 3, class: 'pm-md-delim' },
      { from: 3, to: 5, class: 'pm-md-bold' },
      { from: 5, to: 7, class: 'pm-md-delim' },
    ]);
  });

  it('decorates an inline-code `` `…` `` span', () => {
    //   `  h  i  `
    //   1  2  3  4  5
    const decorations = buildMarkdownDecorations(docFromText('`hi`'));

    expect(toDecorationViews(decorations)).toEqual([
      { from: 1, to: 2, class: 'pm-md-delim' },
      { from: 2, to: 4, class: 'pm-md-inline-code' },
      { from: 4, to: 5, class: 'pm-md-delim' },
    ]);
  });

  it('decorates a note-link `[[…]]` span', () => {
    //   [  [  h  i  ]  ]
    //   1  2  3  4  5  6  7
    const decorations = buildMarkdownDecorations(docFromText('[[hi]]'));

    expect(toDecorationViews(decorations)).toEqual([
      { from: 1, to: 3, class: 'pm-md-delim' },
      { from: 3, to: 5, class: 'pm-md-note-link' },
      { from: 5, to: 7, class: 'pm-md-delim' },
    ]);
  });

  it('decorates multiple ranges in one paragraph', () => {
    //   *  a  *     *  *  b  *  *
    //   1  2  3  4  5  6  7  8  9
    const decorations = buildMarkdownDecorations(docFromText('*a* **b**'));

    expect(toDecorationViews(decorations)).toEqual([
      { from: 1, to: 2, class: 'pm-md-delim' }, // *
      { from: 2, to: 3, class: 'pm-md-italic' },
      { from: 3, to: 4, class: 'pm-md-delim' }, // *
      { from: 5, to: 7, class: 'pm-md-delim' }, // **
      { from: 7, to: 8, class: 'pm-md-bold' },
      { from: 8, to: 10, class: 'pm-md-delim' }, // **
    ]);
  });

  it('produces no decorations for plain text', () => {
    const decorations = buildMarkdownDecorations(docFromText('just text'));

    expect(toDecorationViews(decorations)).toEqual([]);
  });
});

describe('buildMarkdownDecorations Obsidian callouts', () => {
  it('decorates a callout blockquote marker and title', () => {
    const decorations = buildMarkdownDecorations(
      docFromBlockquote('[!info] Info\nBody'),
    );

    expect(toDecorationViews(decorations)).toEqual([
      { from: 0, to: 19, class: 'pm-callout' },
      { from: 1, to: 8, class: 'pm-md-delim pm-callout-marker' },
      { from: 9, to: 13, class: 'pm-callout-title' },
    ]);
  });

  it('does not decorate regular blockquotes as callouts', () => {
    const decorations = buildMarkdownDecorations(
      docFromBlockquote('regular quote'),
    );

    expect(toDecorationViews(decorations)).toEqual([]);
  });
});

describe('buildMarkdownDecorations code fences', () => {
  it('decorates opening fence, content, and closing fence', () => {
    // Code-block text (offsets 0-indexed within the block):
    //   ```ts\nconst\n```
    //    0..5    6..11   12..15
    // PM positions: codeBlock starts at pos 0, text content at pos 1.
    const decorations = buildMarkdownDecorations(
      docFromCodeBlock('```ts\nconst\n```'),
    );

    expect(toDecorationViews(decorations)).toEqual([
      { from: 1, to: 6, class: 'pm-md-delim pm-md-code-fence' },
      { from: 7, to: 12, class: 'pm-md-code-content' },
      { from: 13, to: 16, class: 'pm-md-delim pm-md-code-fence' },
    ]);
  });

  it('treats lines as content when there is no opening fence', () => {
    const decorations = buildMarkdownDecorations(
      docFromCodeBlock('not a fence'),
    );

    // No backtick at all means addFenceDecorations bails before parsing.
    expect(toDecorationViews(decorations)).toEqual([]);
  });
});

describe('buildMarkdownDecorations note-link escapes', () => {
  it('decorates the leading `\\` of `\\#` inside a note link', () => {
    // Doc text positions (1-indexed):
    //   [  [  F  o  o  \  #  B  a  r  ]  ]
    //   1  2  3  4  5  6  7  8  9 10 11 12 13
    const decorations = buildMarkdownDecorations(docFromText('[[Foo\\#Bar]]'));

    expect(delimRangesIn(decorations)).toEqual([
      [1, 3], // [[
      [6, 7], // \  (the escape leader)
      [11, 13], // ]]
    ]);
  });

  it('decorates only the first `\\` of `\\\\` (literal backslash)', () => {
    //   [  [  A  \  \  B  ]  ]
    //   1  2  3  4  5  6  7  8  9
    const decorations = buildMarkdownDecorations(docFromText('[[A\\\\B]]'));

    expect(delimRangesIn(decorations)).toEqual([
      [1, 3], // [[
      [4, 5], // first \ only
      [7, 9], // ]]
    ]);
  });

  it('decorates each leading `\\` in adjacent escape pairs', () => {
    //   [  [  \  #  \  #  ]  ]
    //   1  2  3  4  5  6  7  8  9
    const decorations = buildMarkdownDecorations(docFromText('[[\\#\\#]]'));

    expect(delimRangesIn(decorations)).toEqual([
      [1, 3], // [[
      [3, 4], // first escape leader
      [5, 6], // second escape leader
      [7, 9], // ]]
    ]);
  });

  it('does not decorate a trailing lone `\\` before the closing `]]`', () => {
    //   [  [  F  o  o  \  ]  ]
    //   1  2  3  4  5  6  7  8  9
    const decorations = buildMarkdownDecorations(docFromText('[[Foo\\]]'));

    expect(delimRangesIn(decorations)).toEqual([
      [1, 3], // [[
      [7, 9], // ]]  (lone trailing \ stays as content)
    ]);
  });

  it('produces no escape decorations for a note link without escapes', () => {
    const decorations = buildMarkdownDecorations(docFromText('[[Foo]]'));

    expect(delimRangesIn(decorations)).toEqual([
      [1, 3], // [[
      [6, 8], // ]]
    ]);
  });

  it('does not decorate `\\` escapes inside an italic span', () => {
    // Escape syntax is note-link-only — italic content is rendered as-is.
    //   *  F  o  o  \  #  B  a  r  *
    //   1  2  3  4  5  6  7  8  9 10 11
    const decorations = buildMarkdownDecorations(docFromText('*Foo\\#Bar*'));

    expect(delimRangesIn(decorations)).toEqual([
      [1, 2], // opening *
      [10, 11], // closing *
    ]);
  });
});
