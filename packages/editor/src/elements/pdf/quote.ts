import type { EditorState, Transaction } from 'prosemirror-state';

/** Offsets into one page's text; `page` is the PDF's own page index, so reordering pages keeps it. */
export interface PdfQuoteTarget {
  pdfId: string;
  page: number;
  from: number;
  to: number;
}

export interface PdfQuote {
  target: PdfQuoteTarget;
  text: string;
  label: string;
}

const HREF_RE = /^myelin-pdf:([\w-]+)\/(\d+)\/(\d+)-(\d+)$/;
export const PDF_QUOTE_LINK_SELECTOR = 'a[href^="myelin-pdf:"]';

export function pdfQuoteHref({
  pdfId,
  page,
  from,
  to,
}: PdfQuoteTarget): string {
  return `myelin-pdf:${pdfId}/${page}/${from}-${to}`;
}

// `null` for any other href, including malformed pasted ones.
export function parsePdfQuoteHref(href: string): PdfQuoteTarget | null {
  const match = HREF_RE.exec(href);
  if (!match) {
    return null;
  }
  const [, pdfId, page, from, to] = match;
  return Number(from) < Number(to)
    ? { pdfId, page: Number(page), from: Number(from), to: Number(to) }
    : null;
}

/** Inserts `quote` after the top-level block holding `pos`, or in its place when that block is empty. */
export function insertPdfQuote(
  state: EditorState,
  pos: number,
  quote: PdfQuote,
): Transaction {
  const { schema } = state;
  const node = schema.nodes.blockquote.create(null, [
    schema.text(quote.text),
    schema.nodes.hardBreak.create(),
    schema.text('— '),
    schema.text(quote.label, [
      schema.marks.link.create({ href: pdfQuoteHref(quote.target) }),
    ]),
  ]);
  const $pos = state.doc.resolve(pos);
  if ($pos.depth === 0) {
    return state.tr.insert(pos, node);
  }
  const block = $pos.node(1);
  return block.isTextblock && block.content.size === 0
    ? state.tr.replaceWith($pos.before(1), $pos.after(1), node)
    : state.tr.insert($pos.after(1), node);
}
