import { TableMap } from 'prosemirror-tables';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { type Break, PAGE_BREAK_GAP, PAGE_GAP, PAGE_PADDING } from './core';

function createStandardBreakWidget(spacer: number, kind: Break['kind']): Node {
  const div = document.createElement('div');
  div.style.display = 'block';
  div.style.height = `${spacer}px`;
  div.style.userSelect = 'none';
  div.style.pointerEvents = 'none';
  div.contentEditable = 'false';
  div.setAttribute('data-page-break', kind);
  return div;
}

function syncTableCellInlineBreakGeometry(div: HTMLElement): void {
  if (!div.isConnected) {
    return;
  }

  const row = div.closest('tr');
  const table = div.closest('table');
  if (!(row instanceof HTMLTableRowElement && table instanceof HTMLElement)) {
    return;
  }

  const rowRect = row.getBoundingClientRect();
  const breakRect = div.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  const editor = div.closest('.pm-editor');
  const maskRect =
    editor instanceof HTMLElement ? editor.getBoundingClientRect() : rowRect;
  const scaleSource =
    editor instanceof HTMLElement && editor.offsetWidth > 0
      ? editor.offsetWidth
      : table.offsetWidth;
  const scaleRect = editor instanceof HTMLElement ? maskRect : tableRect;
  const scale = scaleSource > 0 ? scaleRect.width / scaleSource : 1;
  const invScale = scale > 0 ? 1 / scale : 1;

  div.style.setProperty(
    '--pm-table-cell-break-mask-left',
    `${(maskRect.left - breakRect.left) * invScale}px`,
  );
  div.style.setProperty(
    '--pm-table-cell-break-mask-width',
    `${maskRect.width * invScale}px`,
  );
  div.style.setProperty(
    '--pm-table-cell-break-border-left',
    `${(rowRect.left - breakRect.left) * invScale}px`,
  );
  div.style.setProperty(
    '--pm-table-cell-break-border-width',
    `${rowRect.width * invScale}px`,
  );
}

function createTableCellInlineBreakWidget(spacer: number): Node {
  const div = createStandardBreakWidget(spacer, 'inline') as HTMLElement;
  div.classList.add('pm-table-node__cell-page-break');

  const gapStart = Math.max(0, spacer - PAGE_BREAK_GAP + PAGE_PADDING);
  const gapEnd = Math.min(spacer, gapStart + PAGE_GAP);
  div.style.setProperty('--pm-table-cell-break-gap-start', `${gapStart}px`);
  div.style.setProperty('--pm-table-cell-break-gap-end', `${gapEnd}px`);
  div.style.setProperty('--pm-table-cell-break-height', `${spacer}px`);

  requestAnimationFrame(() => {
    syncTableCellInlineBreakGeometry(div);
  });
  return div;
}

function isPositionInsideTable(view: EditorView, pos: number): boolean {
  try {
    const $pos = view.state.doc.resolve(pos);
    for (let depth = $pos.depth; depth >= 0; depth--) {
      if ($pos.node(depth).type.name === 'table') {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function getTableColumnCountAtPos(view: EditorView, pos: number): number {
  const $pos = view.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'table') {
      return TableMap.get(node).width;
    }
  }
  return 1;
}

function createTableRowBreakWidget(
  view: EditorView,
  pos: number,
  spacer: number,
): Node {
  const row = document.createElement('tr');
  row.className = 'pm-table-node__page-break-row';
  row.contentEditable = 'false';
  row.setAttribute('data-page-break', 'table-row');

  const cell = document.createElement('td');
  cell.className = 'pm-table-node__page-break-cell';
  cell.colSpan = getTableColumnCountAtPos(view, pos);
  cell.contentEditable = 'false';

  const gap = document.createElement('div');
  gap.className = 'pm-table-node__page-break-spacer';
  gap.style.height = `${spacer}px`;
  gap.setAttribute('aria-hidden', 'true');

  cell.appendChild(gap);
  row.appendChild(cell);
  return row;
}

export function buildPaginationDecorations(
  view: EditorView,
  breaks: Break[],
): DecorationSet {
  if (breaks.length === 0) {
    return DecorationSet.empty;
  }
  return DecorationSet.create(
    view.state.doc,
    breaks.map(({ pos, spacer, kind }) =>
      Decoration.widget(
        pos,
        () =>
          kind === 'table-row'
            ? createTableRowBreakWidget(view, pos, spacer)
            : kind === 'inline' && isPositionInsideTable(view, pos)
              ? createTableCellInlineBreakWidget(spacer)
              : createStandardBreakWidget(spacer, kind),
        {
          side: -1,
          ignoreSelection: true,
          key: `pb-${kind}-${pos}-${spacer}`,
        },
      ),
    ),
  );
}

interface BlockquoteRuleSegment {
  height: number;
  top: number;
}

const BLOCKQUOTE_RULE_PROPS = [
  '--pm-blockquote-rule-images',
  '--pm-blockquote-rule-positions',
  '--pm-blockquote-rule-sizes',
  '--pm-blockquote-rule-repeats',
  '--pm-callout-fill-images',
  '--pm-callout-fill-positions',
  '--pm-callout-fill-sizes',
  '--pm-callout-fill-repeats',
] as const;

// Only write properties that changed ('' means "not set"). This runs on every pagination pass,
// so unconditional writes dirty style and force a layer flush even when nothing moved.
function applyBlockquoteRuleStyle(
  blockquote: HTMLElement,
  values: Record<string, string>,
): void {
  for (const prop of BLOCKQUOTE_RULE_PROPS) {
    const value = values[prop] ?? '';
    if (blockquote.style.getPropertyValue(prop) === value) {
      continue;
    }
    if (value === '') {
      blockquote.style.removeProperty(prop);
    } else {
      blockquote.style.setProperty(prop, value);
    }
  }
}

function collectBlockquoteRuleSegments(
  blockquote: HTMLElement,
): BlockquoteRuleSegment[] | null {
  const breakWidgets = Array.from(
    blockquote.querySelectorAll<HTMLElement>(
      ':scope > .ProseMirror-widget[data-page-break="inline"]',
    ),
  );
  if (breakWidgets.length === 0) {
    return null;
  }

  const segments: BlockquoteRuleSegment[] = [];
  let currentTop = 0;

  for (const widget of breakWidgets) {
    const widgetTop = widget.offsetTop;
    if (widgetTop > currentTop) {
      segments.push({ top: currentTop, height: widgetTop - currentTop });
    }
    currentTop = widgetTop + widget.offsetHeight;
  }

  const blockHeight = blockquote.offsetHeight;
  if (blockHeight > currentTop) {
    segments.push({ top: currentTop, height: blockHeight - currentTop });
  }

  return segments.filter((segment) => segment.height > 0);
}

export function syncBlockquoteRuleStyles(view: EditorView): void {
  const blockquotes = view.dom.querySelectorAll<HTMLElement>('blockquote');

  for (const blockquote of blockquotes) {
    const values: Record<string, string> = {};
    const segments = collectBlockquoteRuleSegments(blockquote);
    const isCallout = blockquote.classList.contains('pm-callout');

    if (segments !== null && segments.length === 0) {
      values['--pm-blockquote-rule-images'] = 'none';
      if (isCallout) {
        values['--pm-callout-fill-images'] = 'none';
      }
    } else if (segments !== null) {
      const image =
        'linear-gradient(var(--pm-blockquote-rule-color), var(--pm-blockquote-rule-color))';
      values['--pm-blockquote-rule-images'] = segments
        .map(() => image)
        .join(', ');
      values['--pm-blockquote-rule-positions'] = segments
        .map((segment) => `0 ${segment.top}px`)
        .join(', ');
      values['--pm-blockquote-rule-sizes'] = segments
        .map((segment) => `var(--pm-blockquote-rule-width) ${segment.height}px`)
        .join(', ');
      values['--pm-blockquote-rule-repeats'] = segments
        .map(() => 'no-repeat')
        .join(', ');

      if (isCallout) {
        const calloutFillImage =
          'linear-gradient(var(--pm-callout-fill-color), var(--pm-callout-fill-color))';
        values['--pm-callout-fill-images'] = segments
          .map(() => calloutFillImage)
          .join(', ');
        values['--pm-callout-fill-positions'] = segments
          .map((segment) => `0 ${segment.top}px`)
          .join(', ');
        values['--pm-callout-fill-sizes'] = segments
          .map((segment) => `100% ${segment.height}px`)
          .join(', ');
        values['--pm-callout-fill-repeats'] = segments
          .map(() => 'no-repeat')
          .join(', ');
      }
    }

    applyBlockquoteRuleStyle(blockquote, values);
  }
}
