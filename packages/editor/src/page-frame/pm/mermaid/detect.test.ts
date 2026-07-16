import { describe, expect, it } from 'vitest';
import { isMermaidBlock } from './detect';

describe('isMermaidBlock', () => {
  it('matches a mermaid fence token, case-insensitively', () => {
    expect(isMermaidBlock('```mermaid\ngraph TD\n```')).toBe(true);
    expect(isMermaidBlock('```Mermaid\ngraph TD\n```')).toBe(true);
  });

  it('rejects other languages and non-fenced text', () => {
    expect(isMermaidBlock('```python\nx=1\n```')).toBe(false);
    expect(isMermaidBlock('```\nplain\n```')).toBe(false);
    expect(isMermaidBlock('graph TD')).toBe(false);
    expect(isMermaidBlock('')).toBe(false);
  });

  it('rejects tokens that merely start with mermaid', () => {
    expect(isMermaidBlock('```mermaidjs\nx\n```')).toBe(false);
  });

  it('matches while the block is still being typed (no closing fence)', () => {
    expect(isMermaidBlock('```mermaid')).toBe(true);
    expect(isMermaidBlock('```mermaid\ngraph TD')).toBe(true);
  });
});
