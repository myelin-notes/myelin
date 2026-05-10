import { describe, expect, it } from 'vitest';
import {
  formatExplorerItemAccessibleName,
  formatSemanticTagAccessibleName,
} from './accessibility-labels';

describe('library accessibility labels', () => {
  it('separates semantic tag names from singular counts', () => {
    expect(formatSemanticTagAccessibleName('cu-test-tag', 1, '1')).toBe(
      '#cu-test-tag, 1 item',
    );
  });

  it('separates semantic tag names from plural counts', () => {
    expect(formatSemanticTagAccessibleName('stress-tag-008', 107, '107')).toBe(
      '#stress-tag-008, 107 items',
    );
  });

  it('separates item titles from tag names', () => {
    expect(
      formatExplorerItemAccessibleName('CU Test Canvas 20260509', [
        'cu-test-tag',
      ]),
    ).toBe('CU Test Canvas 20260509, tags: #cu-test-tag');
  });

  it('describes hidden overflow tags', () => {
    expect(
      formatExplorerItemAccessibleName('Stress Canvas', [
        'stress-tag-008',
        'stress-tag-107',
        'stress-tag-extra',
      ]),
    ).toBe('Stress Canvas, tags: #stress-tag-008, #stress-tag-107, 1 more tag');
  });
});
