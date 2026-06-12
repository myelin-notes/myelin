import { describe, expect, it } from 'vitest';
import {
  addChild,
  createEmptyManifest,
  createFileNode,
  searchNodeResults,
  searchNodeResultsSemantically,
} from './shared';

describe('repository search helpers', () => {
  it('ranks semantic results by local note embeddings', () => {
    const manifest = createEmptyManifest();
    const now = 1;
    manifest.nodes.alpha = createFileNode(
      'alpha',
      'Alpha',
      'mcanvas',
      null,
      now,
    );
    manifest.nodes.beta = createFileNode('beta', 'Beta', 'mcanvas', null, now);
    manifest.nodes.gamma = createFileNode(
      'gamma',
      'Gamma',
      'mcanvas',
      null,
      now,
    );
    addChild(manifest, null, 'alpha');
    addChild(manifest, null, 'beta');
    addChild(manifest, null, 'gamma');

    const content = new Map([
      ['alpha', 'cell biology notes'],
      ['beta', 'music theory notes'],
      ['gamma', 'stale model vector note'],
    ]);
    const embeddings = new Map([
      ['alpha', { model: 'test', dim: 2, vector: [1, 0] }],
      ['beta', { model: 'test', dim: 2, vector: [0, 1] }],
      ['gamma', { model: 'other', dim: 2, vector: [1, 0] }],
    ]);

    const results = searchNodeResultsSemantically(
      manifest,
      'biology',
      { model: 'test', dim: 2, vector: [0.9, 0.1] },
      content,
      embeddings,
    );

    expect(results.map((result) => result.node.id)).toEqual(['alpha', 'beta']);
    expect(results[0].searchMode).toBe('semantic');
    expect(results[0].matchedTerms).toEqual([]);
    expect(results[0].contentSnippet).toBe('cell biology notes');

    const lexical = searchNodeResults(manifest, 'biology', content);
    expect(lexical.map((result) => result.node.id)).toEqual(['alpha']);
    expect(lexical[0].searchMode).toBe('lexical');
  });

  it('filters non-positive semantic scores', () => {
    const manifest = createEmptyManifest();
    const now = 1;
    manifest.nodes.alpha = createFileNode(
      'alpha',
      'Alpha',
      'mcanvas',
      null,
      now,
    );
    manifest.nodes.beta = createFileNode('beta', 'Beta', 'mcanvas', null, now);
    manifest.nodes.gamma = createFileNode(
      'gamma',
      'Gamma',
      'mcanvas',
      null,
      now,
    );
    addChild(manifest, null, 'alpha');
    addChild(manifest, null, 'beta');
    addChild(manifest, null, 'gamma');

    const content = new Map([
      ['alpha', 'positive match'],
      ['beta', 'orthogonal match'],
      ['gamma', 'opposite match'],
    ]);
    const embeddings = new Map([
      ['alpha', { model: 'test', dim: 2, vector: [1, 0] }],
      ['beta', { model: 'test', dim: 2, vector: [0, 1] }],
      ['gamma', { model: 'test', dim: 2, vector: [-1, 0] }],
    ]);

    const results = searchNodeResultsSemantically(
      manifest,
      'alpha',
      { model: 'test', dim: 2, vector: [1, 0] },
      content,
      embeddings,
    );

    expect(results.map((result) => result.node.id)).toEqual(['alpha']);
  });
});
