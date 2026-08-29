import { type MarkSpec, type NodeSpec, Schema } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';
import { ADAPTIVE_INK } from '../../canvas-theme';

/** CSS the adaptive-ink hex renders as; see the `textColor` mark. */
const INK_VAR = 'var(--text-primary)';

const doc: NodeSpec = {
  content: 'block+',
};

const paragraph: NodeSpec = {
  content: 'inline*',
  group: 'block textblock',
  toDOM() {
    return ['p', 0];
  },
  parseDOM: [{ tag: 'p' }],
};

const heading: NodeSpec = {
  content: 'inline*',
  group: 'block textblock',
  attrs: { level: { default: 1 } },
  defining: true,
  toDOM(node) {
    return [`h${node.attrs.level}`, 0];
  },
  parseDOM: [
    { tag: 'h1', attrs: { level: 1 } },
    { tag: 'h2', attrs: { level: 2 } },
    { tag: 'h3', attrs: { level: 3 } },
  ],
};

const bulletListItem: NodeSpec = {
  content: 'inline*',
  group: 'block textblock',
  defining: true,
  attrs: { indent: { default: 0 } },
  toDOM(node) {
    const indent = node.attrs.indent as number;
    return [
      'div',
      {
        class: 'bullet-list-item',
        ...(indent > 0 ? { 'data-indent': indent } : {}),
      },
      0,
    ];
  },
  parseDOM: [
    {
      tag: 'div.bullet-list-item',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return { indent: Number(el.getAttribute('data-indent')) || 0 };
      },
    },
    {
      tag: 'li',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return el.parentElement?.tagName === 'UL' ? { indent: 0 } : false;
      },
    },
  ],
};

const orderedListItem: NodeSpec = {
  content: 'inline*',
  group: 'block textblock',
  defining: true,
  attrs: { order: { default: 1 }, indent: { default: 0 } },
  toDOM(node) {
    const indent = node.attrs.indent as number;
    return [
      'div',
      {
        class: 'ordered-list-item',
        'data-order': node.attrs.order,
        ...(indent > 0 ? { 'data-indent': indent } : {}),
      },
      0,
    ];
  },
  parseDOM: [
    {
      tag: 'div.ordered-list-item',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          order: Number(el.getAttribute('data-order')) || 1,
          indent: Number(el.getAttribute('data-indent')) || 0,
        };
      },
    },
    {
      tag: 'li',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        if (el.parentElement?.tagName !== 'OL') {
          return false;
        }
        const parent = el.parentElement;
        const start = Number(parent.getAttribute('start')) || 1;
        const index = Array.from(parent.children).indexOf(el);
        return { order: start + index, indent: 0 };
      },
    },
  ],
};

const checkListItem: NodeSpec = {
  content: 'inline*',
  group: 'block textblock',
  defining: true,
  attrs: { checked: { default: false }, indent: { default: 0 } },
  toDOM(node) {
    const checked = node.attrs.checked === true;
    const indent = node.attrs.indent as number;
    return [
      'div',
      {
        class: 'check-list-item',
        'data-checked': checked ? 'true' : 'false',
        ...(indent > 0 ? { 'data-indent': indent } : {}),
      },
      [
        'input',
        {
          type: 'checkbox',
          'data-check-list-marker': 'true',
          contenteditable: 'false',
          ...(checked ? { checked: 'checked' } : {}),
        },
      ],
      ['span', { class: 'check-list-item-content' }, 0],
    ];
  },
  parseDOM: [
    {
      tag: 'div.check-list-item',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          checked: el.getAttribute('data-checked') === 'true',
          indent: Number(el.getAttribute('data-indent')) || 0,
        };
      },
    },
    {
      tag: 'li',
      priority: 60,
      getAttrs(dom) {
        const el = dom as HTMLElement;
        const input = el.querySelector<HTMLInputElement>(
          'input[type="checkbox"]',
        );
        if (!input || el.parentElement?.tagName !== 'UL') {
          return false;
        }
        return { checked: input.checked, indent: 0 };
      },
    },
  ],
};

const blockquote: NodeSpec = {
  content: 'inline*',
  group: 'block textblock',
  defining: true,
  toDOM() {
    return ['blockquote', 0];
  },
  parseDOM: [{ tag: 'blockquote' }],
};

const hardBreak: NodeSpec = {
  inline: true,
  group: 'inline',
  selectable: false,
  linebreakReplacement: true,
  toDOM() {
    return ['br'];
  },
  parseDOM: [{ tag: 'br' }],
};

const codeBlock: NodeSpec = {
  content: 'text*',
  group: 'block textblock',
  marks: '',
  code: true,
  defining: true,
  // Minted lazily on first run; links the block to its canvas output element across reloads.
  attrs: { blockId: { default: null } },
  toDOM(node) {
    return node.attrs.blockId
      ? ['pre', { 'data-block-id': node.attrs.blockId }, ['code', 0]]
      : ['pre', ['code', 0]];
  },
  parseDOM: [
    {
      tag: 'pre',
      preserveWhitespace: 'full',
      getAttrs(dom) {
        return { blockId: (dom as HTMLElement).getAttribute('data-block-id') };
      },
    },
  ],
};

const mathBlock: NodeSpec = {
  content: 'text*',
  group: 'block textblock',
  marks: '',
  code: true,
  defining: true,
  toDOM() {
    return ['div', { class: 'pm-math-block' }, 0];
  },
  parseDOM: [{ tag: 'div.pm-math-block', preserveWhitespace: 'full' }],
};

const horizontalRule: NodeSpec = {
  group: 'block',
  toDOM() {
    return ['hr'];
  },
  parseDOM: [{ tag: 'hr' }],
};

/**
 * Reserved space in the flow for canvas elements anchored to this point in the document.
 * `height` of 0 makes it a pure position marker: anchored ink floats over the content below it
 * without displacing anything. Never breakable, so pagination moves a band whole to the next page
 * and its ink travels with it.
 */
const canvasBand: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: false,
  attrs: { bandId: {}, height: { default: 0 } },
  toDOM(node) {
    return [
      'div',
      {
        class: 'pm-canvas-band',
        'data-band-id': node.attrs.bandId,
        style: `height:${node.attrs.height}px`,
        contenteditable: 'false',
      },
    ];
  },
  parseDOM: [
    {
      tag: 'div.pm-canvas-band',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          bandId: el.getAttribute('data-band-id'),
          height: Number.parseFloat(el.style.height) || 0,
        };
      },
    },
  ],
};

const mention: NodeSpec = {
  inline: true,
  group: 'inline',
  attrs: { id: {}, label: {} },
  atom: true,
  toDOM(node) {
    return [
      'span',
      { class: 'mention', 'data-mention-id': node.attrs.id },
      `@${node.attrs.label}`,
    ];
  },
  parseDOM: [
    {
      tag: 'span.mention',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          id: el.getAttribute('data-mention-id'),
          label: (el.textContent ?? '').replace(/^@/, ''),
        };
      },
    },
  ],
};

const bold: MarkSpec = {
  toDOM() {
    return ['strong', 0];
  },
  parseDOM: [
    { tag: 'strong' },
    { tag: 'b' },
    {
      style: 'font-weight',
      getAttrs: (value) =>
        /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null,
    },
  ],
};

const italic: MarkSpec = {
  toDOM() {
    return ['em', 0];
  },
  parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
};

const underline: MarkSpec = {
  toDOM() {
    return ['u', 0];
  },
  parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
};

const strikethrough: MarkSpec = {
  toDOM() {
    return ['s', 0];
  },
  parseDOM: [
    { tag: 's' },
    { tag: 'del' },
    { style: 'text-decoration=line-through' },
  ],
};

const code: MarkSpec = {
  excludes: '_',
  toDOM() {
    return ['code', 0];
  },
  parseDOM: [{ tag: 'code' }],
};

const fontFamily: MarkSpec = {
  attrs: { family: {} },
  toDOM(mark) {
    return ['span', { style: `font-family: ${mark.attrs.family}` }, 0];
  },
  parseDOM: [
    {
      style: 'font-family',
      getAttrs: (value) => {
        if (typeof value !== 'string' || !value) {
          return false;
        }
        return { family: value };
      },
    },
  ],
};

const textColor: MarkSpec = {
  attrs: { color: {} },
  toDOM(mark) {
    // The doc stores the adaptive-ink hex; display resolves it to the theme
    // token so ink stays legible on a dark page. parseDOM folds it back.
    const color =
      mark.attrs.color === ADAPTIVE_INK ? INK_VAR : mark.attrs.color;
    return ['span', { style: `color: ${color}` }, 0];
  },
  parseDOM: [
    {
      style: 'color',
      getAttrs: (value) => {
        if (typeof value !== 'string' || !value) {
          return false;
        }
        return { color: value === INK_VAR ? ADAPTIVE_INK : value };
      },
    },
  ],
};

const noteLink: MarkSpec = {
  attrs: {
    title: {},
    noteId: { default: null },
    pageFrameId: { default: null },
  },
  inclusive: false,
  toDOM(mark) {
    const attrs: Record<string, string> = {
      'data-note-link-title': mark.attrs.title,
    };
    if (typeof mark.attrs.noteId === 'string' && mark.attrs.noteId.length > 0) {
      attrs['data-note-id'] = mark.attrs.noteId;
    }
    if (
      typeof mark.attrs.pageFrameId === 'string' &&
      mark.attrs.pageFrameId.length > 0
    ) {
      attrs['data-page-frame-id'] = mark.attrs.pageFrameId;
    }
    return ['span', attrs, 0];
  },
  parseDOM: [
    {
      tag: 'span[data-note-link-title]',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          title: el.getAttribute('data-note-link-title') ?? '',
          noteId: el.getAttribute('data-note-id') || null,
          pageFrameId: el.getAttribute('data-page-frame-id') || null,
        };
      },
    },
  ],
};

const link: MarkSpec = {
  attrs: { href: {}, title: { default: null } },
  inclusive: false,
  toDOM(mark) {
    return [
      'a',
      {
        href: mark.attrs.href,
        title: mark.attrs.title,
        rel: 'noopener',
        class: 'pm-link',
      },
      0,
    ];
  },
  parseDOM: [
    {
      tag: 'a[href]',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          href: el.getAttribute('href'),
          title: el.getAttribute('title'),
        };
      },
    },
  ],
};

const tableSpecs = tableNodes({
  tableGroup: 'block',
  cellContent: 'textblock+',
  cellAttributes: {},
});

export const schema = new Schema({
  nodes: {
    doc,
    paragraph,
    heading,
    bulletListItem,
    orderedListItem,
    checkListItem,
    blockquote,
    hardBreak,
    codeBlock,
    mathBlock,
    horizontalRule,
    canvasBand,
    mention,
    ...tableSpecs,
    text: { group: 'inline' },
  },
  marks: {
    bold,
    italic,
    underline,
    strikethrough,
    code,
    fontFamily,
    textColor,
    noteLink,
    link,
  },
});
