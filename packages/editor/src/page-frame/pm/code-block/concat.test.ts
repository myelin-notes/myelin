import type { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { schema } from '../schema';
import { collectRunSource, parseBlockLanguage, stripFences } from './concat';

function codeBlock(text: string): PMNode {
  return schema.node('codeBlock', null, text ? schema.text(text) : undefined);
}

function paragraph(text: string): PMNode {
  return schema.node('paragraph', null, text ? schema.text(text) : undefined);
}

function docOf(...nodes: PMNode[]): PMNode {
  return schema.node('doc', null, nodes);
}

function fence(lang: string, body: string): string {
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

function codeBlockPositions(doc: PMNode): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      positions.push(pos);
      return false;
    }
    return true;
  });
  return positions;
}

describe('parseBlockLanguage', () => {
  it('resolves the fence token through aliases', () => {
    expect(parseBlockLanguage(fence('py', 'x=1'))).toBe('python');
    expect(parseBlockLanguage(fence('JS', 'x=1'))).toBe('javascript');
    expect(parseBlockLanguage(fence('c++', 'int main(){}'))).toBe('cpp');
  });

  it('returns null for a bare fence or unknown language', () => {
    expect(parseBlockLanguage('```\nx=1\n```')).toBeNull();
    expect(parseBlockLanguage(fence('nim', 'echo 1'))).toBeNull();
  });
});

describe('stripFences', () => {
  it('removes the opening and closing fence lines', () => {
    expect(stripFences(fence('python', 'a=1\nprint(a)'))).toBe('a=1\nprint(a)');
  });

  it('returns text unchanged when it is not fenced', () => {
    expect(stripFences('a=1')).toBe('a=1');
  });
});

describe('collectRunSource', () => {
  it('concatenates same-language blocks up to and including the target', () => {
    const doc = docOf(
      codeBlock(fence('python', 'a=1')),
      paragraph('prose'),
      codeBlock(fence('js', 'x=2')),
      codeBlock(fence('python', 'print(a)')),
    );
    const positions = codeBlockPositions(doc);
    const targetPos = positions[2]; // second python block

    expect(collectRunSource(doc, targetPos)).toEqual({
      language: 'python',
      source: 'a=1\nprint(a)',
    });
  });

  it('excludes blocks after the target', () => {
    const doc = docOf(
      codeBlock(fence('python', 'a=1')),
      codeBlock(fence('python', 'b=2')),
    );
    const positions = codeBlockPositions(doc);

    expect(collectRunSource(doc, positions[0])).toEqual({
      language: 'python',
      source: 'a=1',
    });
  });

  it('isolates other languages from the run', () => {
    const doc = docOf(
      codeBlock(fence('python', 'a=1')),
      codeBlock(fence('js', 'x=2')),
    );
    const positions = codeBlockPositions(doc);

    expect(collectRunSource(doc, positions[1])).toEqual({
      language: 'javascript',
      source: 'x=2',
    });
  });

  it('returns null when the target block is not runnable', () => {
    const doc = docOf(codeBlock('```\nplain\n```'));
    const positions = codeBlockPositions(doc);

    expect(collectRunSource(doc, positions[0])).toBeNull();
  });
});
