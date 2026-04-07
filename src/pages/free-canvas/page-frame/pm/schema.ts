import { type MarkSpec, type NodeSpec, Schema } from 'prosemirror-model';

const doc: NodeSpec = {
  content: 'block+',
};

const paragraph: NodeSpec = {
  content: 'inline*',
  group: 'block',
  toDOM() {
    return ['p', 0];
  },
  parseDOM: [{ tag: 'p' }],
};

const heading: NodeSpec = {
  content: 'inline*',
  group: 'block',
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

const bulletList: NodeSpec = {
  content: 'listItem+',
  group: 'block',
  toDOM() {
    return ['ul', 0];
  },
  parseDOM: [{ tag: 'ul' }],
};

const orderedList: NodeSpec = {
  content: 'listItem+',
  group: 'block',
  attrs: { start: { default: 1 } },
  toDOM(node) {
    return node.attrs.start === 1
      ? ['ol', 0]
      : ['ol', { start: node.attrs.start }, 0];
  },
  parseDOM: [
    {
      tag: 'ol',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          start: el.hasAttribute('start')
            ? Number(el.getAttribute('start'))
            : 1,
        };
      },
    },
  ],
};

const listItem: NodeSpec = {
  content: 'block+',
  defining: true,
  toDOM() {
    return ['li', 0];
  },
  parseDOM: [{ tag: 'li' }],
};

const blockquote: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  toDOM() {
    return ['blockquote', 0];
  },
  parseDOM: [{ tag: 'blockquote' }],
};

const codeBlock: NodeSpec = {
  content: 'text*',
  group: 'block',
  marks: '',
  code: true,
  defining: true,
  toDOM() {
    return ['pre', ['code', 0]];
  },
  parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
};

const horizontalRule: NodeSpec = {
  group: 'block',
  toDOM() {
    return ['hr'];
  },
  parseDOM: [{ tag: 'hr' }],
};

const image: NodeSpec = {
  inline: true,
  group: 'inline',
  attrs: {
    src: {},
    alt: { default: null },
    width: { default: null },
    height: { default: null },
  },
  draggable: true,
  toDOM(node) {
    return ['img', node.attrs];
  },
  parseDOM: [
    {
      tag: 'img[src]',
      getAttrs(dom) {
        const el = dom as HTMLImageElement;
        return {
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt'),
          width: el.naturalWidth || null,
          height: el.naturalHeight || null,
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
  toDOM() {
    return ['code', 0];
  },
  parseDOM: [{ tag: 'code' }],
};

const link: MarkSpec = {
  attrs: { href: {}, title: { default: null } },
  inclusive: false,
  toDOM(mark) {
    return [
      'a',
      { href: mark.attrs.href, title: mark.attrs.title, rel: 'noopener' },
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

export const schema = new Schema({
  nodes: {
    doc,
    paragraph,
    heading,
    bulletList,
    orderedList,
    listItem,
    blockquote,
    codeBlock,
    horizontalRule,
    image,
    mention,
    text: { group: 'inline' },
  },
  marks: {
    bold,
    italic,
    underline,
    strikethrough,
    code,
    link,
  },
});
