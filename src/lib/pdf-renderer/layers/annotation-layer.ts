import type { RenderContext } from '../types';

interface LinkAnnotation {
  subtype: string;
  rect: [number, number, number, number];
  url?: string;
  unsafeUrl?: string;
  dest?: string | unknown[];
  newWindow?: boolean;
}

export async function renderAnnotationLayer(
  ctx: RenderContext,
  onInternalLink?: (dest: string | unknown[]) => void,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  container.className = 'pdf-annotations';
  container.style.position = 'absolute';
  container.style.inset = '0';
  container.style.pointerEvents = 'none';

  const annotations = (await ctx.page.getAnnotations()) as LinkAnnotation[];
  for (const a of annotations) {
    if (a.subtype !== 'Link') {
      continue;
    }
    const [x1, y1, x2, y2] = ctx.viewport.convertToViewportRectangle(a.rect);
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    const el = document.createElement('a');
    el.style.position = 'absolute';
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';

    if (a.url || a.unsafeUrl) {
      el.href = a.url ?? a.unsafeUrl!;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    } else if (a.dest && onInternalLink) {
      const dest = a.dest;
      el.href = '#';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        onInternalLink(dest);
      });
    }
    container.appendChild(el);
  }
  return container;
}
