import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FileType } from '@/lib/sync';
import { getFileTypeIcon } from './file-icon';

function iconClassFor(fileType: FileType): string {
  return renderToString(createElement(getFileTypeIcon(fileType)));
}

describe('getFileTypeIcon', () => {
  it.each([
    ['mcanvas', 'lucide-file-text'],
    ['csv', 'lucide-table-2'],
    ['png', 'lucide-image'],
    ['jpg', 'lucide-image'],
    ['svg', 'lucide-image'],
    ['mp4', 'lucide-film'],
    ['mkv', 'lucide-film'],
  ] as const)('renders %s as %s', (fileType, expected) => {
    expect(iconClassFor(fileType)).toContain(expected);
  });

  it('gives canvases and CSVs different glyphs', () => {
    expect(getFileTypeIcon('csv')).not.toBe(getFileTypeIcon('mcanvas'));
    expect(getFileTypeIcon('png')).not.toBe(getFileTypeIcon('mcanvas'));
  });
});
