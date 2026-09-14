import { describe, expect, it } from 'vitest';
import { YDocManager } from '../../ydoc-manager';
import { ElementType } from '../element-type';
import { LatexElement } from './element';

describe('LatexElement font size', () => {
  it('uses the element scale as its font size', () => {
    const latex = new LatexElement('latex-1');
    latex.setOffset(10, 20);

    latex.setFontSize(32);

    expect(latex.fontSize).toBe(32);
    expect(latex.scale).toEqual({ x: 2, y: 2 });
    expect(latex.boundingBox).toEqual(new DOMRect(10, 20, 280, 88));
  });

  it('persists a size change through its existing scale fields', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.LATEX, 'latex-1', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      latex: '',
    });
    const latex = new LatexElement('latex-1');
    latex.bindToYMap(yMap);

    latex.setFontSize(24);

    expect(yMap.get('scaleX')).toBe(1.5);
    expect(yMap.get('scaleY')).toBe(1.5);

    const reloaded = new LatexElement('latex-1');
    reloaded.bindToYMap(yMap);
    expect(reloaded.fontSize).toBe(24);
  });
});
