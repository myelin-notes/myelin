import { describe, expect, it } from 'vitest';
import { schema } from '../pm/schema';
import { parseMarkdownToDoc } from './parser';
import { serializeDocToMarkdown } from './serializer';

describe('inline code serialization', () => {
  it('keeps code text identical across repeated read/write cycles', () => {
    let md = 'a `**not bold** \\x` b ``x`y`` c `` `tick` `` d';
    const text = parseMarkdownToDoc(md, schema).textContent;
    expect(text).toBe('a **not bold** \\x b x`y c `tick` d');
    for (let i = 0; i < 3; i++) {
      md = serializeDocToMarkdown(parseMarkdownToDoc(md, schema));
      expect(parseMarkdownToDoc(md, schema).textContent).toBe(text);
    }
  });
});
