import { PAGE_GAP } from '../elements/page-frame-constants';

const PRINT_HOST_ID = 'page-frame-pdf-print-host';
const PRINT_STYLE_ID = 'page-frame-pdf-print-style';
const PAGE_BACKGROUND = '#ffffff';
const CLEANUP_DELAY_MS = 60_000;

interface PageFramePdfPrintOptions {
  contentDiv: HTMLDivElement;
  pageCount: number;
  pageHeight: number;
  pageWidth: number;
}

export async function printPageFrameToPdf({
  contentDiv,
  pageCount,
  pageHeight,
  pageWidth,
}: PageFramePdfPrintOptions): Promise<void> {
  if (pageCount < 1) {
    throw new Error('Nothing to export.');
  }

  await waitForFonts();
  cleanupPrintArtifacts();

  const style = createPrintStyle(pageWidth, pageHeight);
  const host = createPrintHost(pageWidth);
  const pages = createPrintPages({
    contentDiv,
    pageCount,
    pageHeight,
    pageWidth,
  });
  for (const page of pages) {
    host.appendChild(page);
  }

  document.head.appendChild(style);
  document.body.appendChild(host);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    cleanupPrintArtifacts();
  };

  window.addEventListener('afterprint', cleanup, { once: true });
  await nextFrame();
  window.print();
  window.setTimeout(cleanup, CLEANUP_DELAY_MS);
}

function createPrintStyle(
  pageWidth: number,
  pageHeight: number,
): HTMLStyleElement {
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
@media screen {
  #${PRINT_HOST_ID} {
    left: -100000px;
    pointer-events: none;
    position: fixed;
    top: 0;
    z-index: -1;
  }
}

@media print {
  @page {
    size: ${pageWidth}px ${pageHeight}px;
    margin: 0;
  }

  html,
  body {
    background: ${PAGE_BACKGROUND} !important;
    margin: 0 !important;
    overflow: visible !important;
    padding: 0 !important;
    width: ${pageWidth}px !important;
  }

  body > :not(#${PRINT_HOST_ID}) {
    display: none !important;
  }

  #${PRINT_HOST_ID} {
    display: block !important;
    left: auto !important;
    pointer-events: none !important;
    position: static !important;
    top: auto !important;
    width: ${pageWidth}px !important;
    z-index: auto !important;
  }

  #${PRINT_HOST_ID},
  #${PRINT_HOST_ID} * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  #${PRINT_HOST_ID} .page-frame-print-page {
    background: ${PAGE_BACKGROUND};
    break-after: page;
    height: ${pageHeight}px;
    overflow: hidden;
    page-break-after: always;
    position: relative;
    width: ${pageWidth}px;
  }

  #${PRINT_HOST_ID} .page-frame-print-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }

  #${PRINT_HOST_ID} .pm-editor {
    -webkit-user-select: text !important;
    user-select: text !important;
  }

  #${PRINT_HOST_ID} .ProseMirror {
    outline: none !important;
  }
}
`;
  return style;
}

function createPrintHost(pageWidth: number): HTMLDivElement {
  const host = document.createElement('div');
  host.id = PRINT_HOST_ID;
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    left: '-100000px',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    width: `${pageWidth}px`,
    zIndex: '-1',
  } as Partial<CSSStyleDeclaration>);
  return host;
}

function createPrintPages({
  contentDiv,
  pageCount,
  pageHeight,
  pageWidth,
}: PageFramePdfPrintOptions): HTMLDivElement[] {
  const totalHeight =
    pageCount * pageHeight + Math.max(0, pageCount - 1) * PAGE_GAP;

  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const page = document.createElement('div');
    page.className = 'page-frame-print-page';
    Object.assign(page.style, {
      background: PAGE_BACKGROUND,
      height: `${pageHeight}px`,
      overflow: 'hidden',
      position: 'relative',
      width: `${pageWidth}px`,
    } as Partial<CSSStyleDeclaration>);

    const viewportClone = createViewportClone(pageWidth, totalHeight);
    const contentClone = contentDiv.cloneNode(true) as HTMLDivElement;
    prepareContentClone(contentClone, {
      pageHeight,
      pageIndex,
      pageWidth,
      totalHeight,
    });
    viewportClone.appendChild(contentClone);
    page.appendChild(viewportClone);
    return page;
  });
}

function createViewportClone(
  pageWidth: number,
  totalHeight: number,
): HTMLDivElement {
  const zoom = window.devicePixelRatio || 1;
  const viewportClone = document.createElement('div');
  viewportClone.className = 'page-frame-print-viewport';
  Object.assign(viewportClone.style, {
    height: `${totalHeight}px`,
    left: '0',
    position: 'absolute',
    top: '0',
    transform: `scale(${1 / zoom})`,
    transformOrigin: '0 0',
    width: `${pageWidth}px`,
    zoom: `${zoom}`,
  } as Partial<CSSStyleDeclaration>);
  viewportClone.style.setProperty('--vp-zoom', `${zoom}`);
  return viewportClone;
}

function prepareContentClone(
  contentClone: HTMLDivElement,
  {
    pageHeight,
    pageIndex,
    pageWidth,
    totalHeight,
  }: {
    pageHeight: number;
    pageIndex: number;
    pageWidth: number;
    totalHeight: number;
  },
): void {
  const pageTop = pageIndex * (pageHeight + PAGE_GAP);

  Object.assign(contentClone.style, {
    bottom: 'auto',
    height: `${totalHeight}px`,
    left: '0',
    position: 'absolute',
    right: 'auto',
    top: `${-pageTop}px`,
    transform: 'none',
    width: `${pageWidth}px`,
    zoom: '1',
  } as Partial<CSSStyleDeclaration>);

  // Monaco code blocks are DPR-scaled internally and counter-scaled by the
  // page-frame viewport, so the print clone needs the same custom property.
  contentClone.style.setProperty(
    '--vp-zoom',
    `${window.devicePixelRatio || 1}`,
  );

  for (const el of contentClone.querySelectorAll('[contenteditable]')) {
    el.removeAttribute('contenteditable');
  }
  for (const el of contentClone.querySelectorAll(
    '.ProseMirror-focused, .ProseMirror-selectednode',
  )) {
    el.classList.remove('ProseMirror-focused', 'ProseMirror-selectednode');
  }
  for (const el of contentClone.querySelectorAll(
    '.selectedCell, .pm-selection',
  )) {
    el.classList.remove('selectedCell', 'pm-selection');
  }
  for (const el of contentClone.querySelectorAll(
    '.ProseMirror-cursor, .pm-table-node__handles, .pm-table-node__handle-target',
  )) {
    el.remove();
  }
}

function cleanupPrintArtifacts(): void {
  document.getElementById(PRINT_HOST_ID)?.remove();
  document.getElementById(PRINT_STYLE_ID)?.remove();
}

async function waitForFonts(): Promise<void> {
  const fonts = document.fonts;
  if (!fonts) {
    return;
  }
  try {
    await fonts.ready;
  } catch {
    // Best effort: missing font readiness should not block export.
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
