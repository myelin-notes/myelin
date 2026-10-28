import { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { schema } from '../../page-frame/pm/schema';
import { insertPdfQuote, type PdfQuote, parsePdfQuoteHref } from './quote';

const quote: PdfQuote = {
  target: { pdfId: 'pdf-1', page: 12, from: 40, to: 95 },
  text: 'we must discuss nuclear physics in a phenomenological way',
  label: 'Krane, p.13',
};

function stateWith(...paragraphs: string[]): EditorState {
  return EditorState.create({
    doc: schema.node(
      'doc',
      null,
      paragraphs.map((text) =>
        schema.node('paragraph', null, text ? schema.text(text) : []),
      ),
    ),
  });
}

function blocks(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.forEach((node) => {
    out.push(`${node.type.name}:${node.textContent}`);
  });
  return out;
}

describe('parsePdfQuoteHref', () => {
  it('reads back the target its link was written with', () => {
    const href = insertPdfQuote(
      stateWith(''),
      1,
      quote,
    ).doc.firstChild?.lastChild?.marks.find(
      (mark) => mark.type === schema.marks.link,
    )?.attrs.href as string;

    expect(parsePdfQuoteHref(href)).toEqual(quote.target);
  });

  it('rejects other and malformed hrefs', () => {
    expect(parsePdfQuoteHref('https://example.com')).toBeNull();
    expect(parsePdfQuoteHref('myelin-pdf:pdf-1/12/95-40')).toBeNull();
    expect(parsePdfQuoteHref('myelin-pdf:pdf-1/12/40-95/extra')).toBeNull();
  });
});

describe('insertPdfQuote', () => {
  it('goes after the tapped paragraph without splitting it', () => {
    const state = stateWith('First line', 'Second');
    const next = state.apply(insertPdfQuote(state, 4, quote));

    expect(blocks(next)).toEqual([
      'paragraph:First line',
      `blockquote:${quote.text}— Krane, p.13`,
      'paragraph:Second',
    ]);
  });

  it('replaces the empty paragraph it lands on', () => {
    const state = stateWith('Notes', '');
    const next = state.apply(insertPdfQuote(state, 8, quote));

    expect(blocks(next)).toEqual([
      'paragraph:Notes',
      `blockquote:${quote.text}— Krane, p.13`,
    ]);
  });
});
