import type { Node as PMNode } from 'prosemirror-model';
import { TableView } from 'prosemirror-tables';
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from 'prosemirror-view';
import {
  buildAddTableColumnTransaction,
  buildAddTableRowTransaction,
  buildDeleteTableColumnTransaction,
  buildDeleteTableRowTransaction,
} from './commands';

const HANDLE_HOVER_STRIP_THICKNESS = 14;
const MIN_COLUMN_RATIO = 0.06;

/** Moves the boundary after column `index` by `delta` of the table width, within the pair's room. */
export function resizeColumnRatios(
  ratios: readonly number[],
  index: number,
  delta: number,
): number[] {
  const pair = ratios[index] + ratios[index + 1];
  const left = Math.max(
    MIN_COLUMN_RATIO,
    Math.min(pair - MIN_COLUMN_RATIO, ratios[index] + delta),
  );
  const next = [...ratios];
  next[index] = left;
  next[index + 1] = pair - left;
  return next;
}

export class PageFrameTableNodeView implements NodeView {
  public readonly dom: HTMLDivElement;
  public readonly contentDOM: HTMLTableSectionElement;

  private readonly tableView: TableView;
  private readonly handleLayer: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver | null;
  private pendingRenderFrame = 0;
  private hoveredRowIndex: number | null = null;
  private hoveredColumnIndex: number | null = null;
  // Live ratios while a column drag is in progress; `TableView.update` resets the colgroup, so
  // updates mid-drag (e.g. pagination reacting to reflow) must reapply these, not the stored ones.
  private dragRatios: number[] | null = null;

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number,
  ) {
    // prosemirror-tables sets the table's min-width to columns × this, overflowing the frame; columns
    // instead share 100% of the width, floored by MIN_COLUMN_RATIO on resize.
    this.tableView = new TableView(node, 0);
    this.dom = this.tableView.dom;
    this.contentDOM = this.tableView.contentDOM;
    this.dom.classList.add('pm-table-node');
    this.tableView.table.classList.add('pm-table-node__table');

    this.handleLayer = document.createElement('div');
    this.handleLayer.className = 'pm-table-node__handles';
    this.dom.appendChild(this.handleLayer);
    this.dom.addEventListener('pointermove', this.handlePointerMove);
    this.dom.addEventListener('pointerleave', this.handlePointerLeave);

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleHandleRender();
      });
      this.resizeObserver.observe(this.tableView.table);
    } else {
      this.resizeObserver = null;
    }

    this.applyColumnRatios(this.storedColumnRatios());
    this.scheduleHandleRender();
  }

  update(node: PMNode): boolean {
    if (!this.tableView.update(node)) {
      return false;
    }

    this.node = node;
    this.applyColumnRatios(this.dragRatios ?? this.storedColumnRatios());
    this.scheduleHandleRender();
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.handleLayer.contains(event.target as Node);
  }

  ignoreMutation(record: ViewMutationRecord): boolean {
    if (record.type === 'selection') {
      return false;
    }

    if (this.handleLayer.contains(record.target as Node)) {
      return true;
    }

    return this.tableView.ignoreMutation(record);
  }

  destroy(): void {
    if (this.pendingRenderFrame !== 0) {
      cancelAnimationFrame(this.pendingRenderFrame);
      this.pendingRenderFrame = 0;
    }
    this.dom.removeEventListener('pointermove', this.handlePointerMove);
    this.dom.removeEventListener('pointerleave', this.handlePointerLeave);
    this.resizeObserver?.disconnect();
  }

  // `null` when unset or stale: adding or deleting a column falls back to even columns.
  private storedColumnRatios(): number[] | null {
    const ratios = this.node.attrs.colRatios as number[] | null;
    return ratios?.length === this.tableView.colgroup.children.length
      ? ratios
      : null;
  }

  private applyColumnRatios(ratios: readonly number[] | null): void {
    if (!ratios) {
      return;
    }
    const { colgroup, table } = this.tableView;
    table.style.width = '100%';
    table.style.minWidth = '';
    Array.from(colgroup.children).forEach((col, index) => {
      const { style } = col as HTMLElement;
      style.width = `${ratios[index] * 100}%`;
      style.minWidth = '';
    });
  }

  private measureColumnRatios(row: HTMLTableRowElement): number[] {
    const total = this.tableView.table.getBoundingClientRect().width;
    return Array.from(row.cells).flatMap((cell) => {
      const ratio = cell.getBoundingClientRect().width / total / cell.colSpan;
      return Array.from({ length: cell.colSpan }, () => ratio);
    });
  }

  private createColumnResizer(
    index: number,
    left: number,
    top: number,
    height: number,
    row: HTMLTableRowElement,
  ): HTMLDivElement {
    const resizer = document.createElement('div');
    resizer.className = 'pm-table-node__column-resizer';
    resizer.style.left = `${left}px`;
    resizer.style.top = `${top}px`;
    resizer.style.height = `${height}px`;
    resizer.addEventListener('pointerdown', (event) => {
      this.beginColumnResize(event, resizer, index, row);
    });
    return resizer;
  }

  private beginColumnResize(
    event: PointerEvent,
    resizer: HTMLDivElement,
    index: number,
    row: HTMLTableRowElement,
  ): void {
    if (!this.view.editable) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const start = this.storedColumnRatios() ?? this.measureColumnRatios(row);
    // Screen px over screen px, so the delta is independent of canvas zoom.
    const tableWidth = this.tableView.table.getBoundingClientRect().width;
    const startX = event.clientX;
    const ratiosAt = (clientX: number) =>
      resizeColumnRatios(start, index, (clientX - startX) / tableWidth);

    const startLeft = Number.parseFloat(resizer.style.left);
    const { table } = this.tableView;

    this.dragRatios = start;
    this.handleLayer.classList.add('pm-table-node__handles--resizing');
    resizer.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      this.dragRatios = ratiosAt(move.clientX);
      this.applyColumnRatios(this.dragRatios);
      // Layout px, same space as the handle layer; rows reflow, so the height changes too.
      resizer.style.left = `${startLeft + (this.dragRatios[index] - start[index]) * table.offsetWidth}px`;
      resizer.style.top = `${table.offsetTop}px`;
      resizer.style.height = `${table.offsetHeight}px`;
    };
    const finish = (end: PointerEvent) => {
      resizer.removeEventListener('pointermove', onMove);
      resizer.removeEventListener('pointerup', finish);
      resizer.removeEventListener('pointercancel', finish);
      this.dragRatios = null;
      this.handleLayer.classList.remove('pm-table-node__handles--resizing');
      this.scheduleHandleRender();
      if (end.type !== 'pointerup') {
        this.applyColumnRatios(this.storedColumnRatios() ?? start);
        return;
      }
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(this.readTablePos(), undefined, {
          ...this.node.attrs,
          colRatios: ratiosAt(end.clientX).map(
            (ratio) => Math.round(ratio * 10_000) / 10_000,
          ),
        }),
      );
    };
    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', finish);
    resizer.addEventListener('pointercancel', finish);
  }

  private readTablePos(): number {
    const pos = this.getPos();
    if (typeof pos !== 'number') {
      throw new Error('table node view position is unavailable');
    }
    return pos;
  }

  private scheduleHandleRender(): void {
    if (this.pendingRenderFrame !== 0) {
      return;
    }

    this.pendingRenderFrame = requestAnimationFrame(() => {
      this.pendingRenderFrame = 0;
      this.renderHandles();
    });
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const hoveredState = this.readHoveredDeleteTargetState(event.target);
    if (
      hoveredState.rowIndex === this.hoveredRowIndex &&
      hoveredState.columnIndex === this.hoveredColumnIndex
    ) {
      return;
    }

    this.hoveredRowIndex = hoveredState.rowIndex;
    this.hoveredColumnIndex = hoveredState.columnIndex;
    this.syncDeleteHandleVisibility();
  };

  private readonly handlePointerLeave = (): void => {
    if (this.hoveredRowIndex === null && this.hoveredColumnIndex === null) {
      return;
    }

    this.hoveredRowIndex = null;
    this.hoveredColumnIndex = null;
    this.syncDeleteHandleVisibility();
  };

  private renderHandles(): void {
    // Replacing the resizer mid-drag would drop its pointer capture.
    if (this.dragRatios) {
      return;
    }
    this.handleLayer.replaceChildren();

    const rows = Array.from(this.contentDOM.rows).filter(
      (row) => row.getAttribute('data-page-break') !== 'table-row',
    );
    if (rows.length === 0) {
      return;
    }

    const handleLayerRect = this.handleLayer.getBoundingClientRect();
    const tableRect = this.tableView.table.getBoundingClientRect();
    if (
      tableRect.width <= 0 ||
      tableRect.height <= 0 ||
      handleLayerRect.width <= 0 ||
      handleLayerRect.height <= 0
    ) {
      return;
    }

    const localXFromScreenX = (screenX: number): number =>
      ((screenX - handleLayerRect.left) / handleLayerRect.width) *
      this.handleLayer.clientWidth;
    const localYFromScreenY = (screenY: number): number =>
      ((screenY - handleLayerRect.top) / handleLayerRect.height) *
      this.handleLayer.clientHeight;
    const tableLeft = localXFromScreenX(tableRect.left);
    const tableRight = localXFromScreenX(tableRect.right);
    const tableTop = localYFromScreenY(tableRect.top);
    const tableBottom = localYFromScreenY(tableRect.bottom);
    const tableWidth = tableRight - tableLeft;
    const tableHeight = tableBottom - tableTop;
    const tableCenterX = localXFromScreenX(
      tableRect.left + tableRect.width / 2,
    );
    const tableCenterY = localYFromScreenY(
      tableRect.top + tableRect.height / 2,
    );

    const columnHandles: Array<{
      index: number;
      boundaryLeft: number;
      left: number;
      width: number;
    }> = [];
    let columnIndex = 0;
    for (const cell of Array.from(rows[0].cells)) {
      const cellRect = cell.getBoundingClientRect();
      const columnWidth = cellRect.width / Math.max(1, cell.colSpan);

      for (
        let spanIndex = 0;
        spanIndex < cell.colSpan;
        spanIndex += 1, columnIndex += 1
      ) {
        const columnLeft = localXFromScreenX(
          cellRect.left + columnWidth * spanIndex,
        );
        const boundaryScreenX = cellRect.left + columnWidth * (spanIndex + 1);
        const boundaryLeft = localXFromScreenX(boundaryScreenX);
        columnHandles.push({
          index: columnIndex,
          boundaryLeft,
          left: columnLeft,
          width: boundaryLeft - columnLeft,
        });
      }
    }

    for (const columnHandle of columnHandles) {
      this.handleLayer.appendChild(
        this.createHandle({
          action: 'add',
          kind: 'column',
          index: columnHandle.index,
          placement: 'column-boundary',
          targetLeft: columnHandle.boundaryLeft,
          targetTop: tableTop,
          targetWidth: HANDLE_HOVER_STRIP_THICKNESS,
          targetHeight: tableHeight,
          buttonLeft: HANDLE_HOVER_STRIP_THICKNESS / 2,
          buttonTop: tableCenterY - tableTop,
        }),
      );
      this.handleLayer.appendChild(
        this.createHandle({
          action: 'delete',
          kind: 'column',
          index: columnHandle.index,
          placement: 'column-delete',
          targetLeft: columnHandle.left,
          targetTop: tableTop,
          targetWidth: columnHandle.width,
          targetHeight: HANDLE_HOVER_STRIP_THICKNESS,
          buttonLeft: columnHandle.width / 2,
          buttonTop: HANDLE_HOVER_STRIP_THICKNESS / 2,
        }),
      );
    }

    for (const columnHandle of columnHandles.slice(0, -1)) {
      this.handleLayer.appendChild(
        this.createColumnResizer(
          columnHandle.index,
          columnHandle.boundaryLeft,
          tableTop,
          tableHeight,
          rows[0],
        ),
      );
    }

    rows.forEach((row, rowIndex) => {
      const rowRect = row.getBoundingClientRect();
      const rowTop = localYFromScreenY(rowRect.top);
      const rowBottom = localYFromScreenY(rowRect.bottom);
      const rowHeight = rowBottom - rowTop;

      this.handleLayer.appendChild(
        this.createHandle({
          action: 'add',
          kind: 'row',
          index: rowIndex,
          placement: 'row-boundary',
          targetLeft: tableLeft,
          targetTop: rowBottom,
          targetWidth: tableWidth,
          targetHeight: HANDLE_HOVER_STRIP_THICKNESS,
          buttonLeft: tableCenterX - tableLeft,
          buttonTop: HANDLE_HOVER_STRIP_THICKNESS / 2,
        }),
      );
      this.handleLayer.appendChild(
        this.createHandle({
          action: 'delete',
          kind: 'row',
          index: rowIndex,
          placement: 'row-delete',
          targetLeft: tableLeft,
          targetTop: rowTop,
          targetWidth: HANDLE_HOVER_STRIP_THICKNESS,
          targetHeight: rowHeight,
          buttonLeft: HANDLE_HOVER_STRIP_THICKNESS / 2,
          buttonTop: rowHeight / 2,
        }),
      );
    });

    this.syncDeleteHandleVisibility();
  }

  private createHandle(options: {
    action: 'add' | 'delete';
    kind: 'column' | 'row';
    index: number;
    placement:
      | 'column-boundary'
      | 'column-delete'
      | 'row-boundary'
      | 'row-delete';
    targetLeft: number;
    targetTop: number;
    targetWidth: number;
    targetHeight: number;
    buttonLeft: number;
    buttonTop: number;
  }): HTMLDivElement {
    const target = document.createElement('div');
    target.className = `pm-table-node__handle-target pm-table-node__handle-target--${options.placement}`;
    target.dataset.handleAction = options.action;
    target.dataset.handleKind = options.kind;
    target.dataset.handleIndex = `${options.index}`;
    target.style.left = `${options.targetLeft}px`;
    target.style.top = `${options.targetTop}px`;
    target.style.width = `${options.targetWidth}px`;
    target.style.height = `${options.targetHeight}px`;

    target.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });

    const button = this.createHandleButton(
      options.kind,
      options.action,
      options.index,
    );
    button.dataset.handleAction = options.action;
    button.dataset.handleKind = options.kind;
    button.dataset.handleIndex = `${options.index}`;
    button.style.left = `${options.buttonLeft}px`;
    button.style.top = `${options.buttonTop}px`;
    target.appendChild(button);
    return target;
  }

  private createHandleButton(
    kind: 'column' | 'row',
    action: 'add' | 'delete',
    index: number,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pm-table-node__handle pm-table-node__handle--${action}`;
    button.setAttribute(
      'aria-label',
      action === 'add'
        ? kind === 'column'
          ? 'Add column after'
          : 'Add row after'
        : kind === 'column'
          ? 'Delete column'
          : 'Delete row',
    );
    button.tabIndex = -1;
    button.textContent = action === 'add' ? '+' : '-';
    button.style.left = '0px';
    button.style.top = '0px';

    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const tablePos = this.readTablePos();
      const tr =
        action === 'add'
          ? kind === 'column'
            ? buildAddTableColumnTransaction(this.view.state, tablePos, index)
            : buildAddTableRowTransaction(this.view.state, tablePos, index)
          : kind === 'column'
            ? buildDeleteTableColumnTransaction(
                this.view.state,
                tablePos,
                index,
              )
            : buildDeleteTableRowTransaction(this.view.state, tablePos, index);
      if (!tr) {
        return;
      }

      this.view.dispatch(tr.scrollIntoView());
      this.view.focus();
    });

    return button;
  }

  private readHoveredDeleteTargetState(target: EventTarget | null): {
    rowIndex: number | null;
    columnIndex: number | null;
  } {
    if (!(target instanceof Element)) {
      return { rowIndex: null, columnIndex: null };
    }

    const deleteHandle = target.closest<HTMLElement>(
      '.pm-table-node__handle-target[data-handle-action="delete"], .pm-table-node__handle[data-handle-action="delete"]',
    );
    if (deleteHandle) {
      const index = Number.parseInt(deleteHandle.dataset.handleIndex ?? '', 10);
      if (!Number.isNaN(index)) {
        return deleteHandle.dataset.handleKind === 'row'
          ? { rowIndex: index, columnIndex: null }
          : { rowIndex: null, columnIndex: index };
      }
    }

    const cell = target.closest<HTMLElement>('th, td');
    if (!cell) {
      return { rowIndex: null, columnIndex: null };
    }

    return {
      rowIndex: this.readRowIndex(cell),
      columnIndex: this.readColumnIndex(cell),
    };
  }

  private readRowIndex(cell: HTMLElement): number | null {
    const row = cell.closest('tr');
    if (!row) {
      return null;
    }

    const rows = Array.from(this.contentDOM.rows).filter(
      (candidate) => candidate.getAttribute('data-page-break') !== 'table-row',
    );
    const rowIndex = rows.indexOf(row);
    return rowIndex >= 0 ? rowIndex : null;
  }

  private readColumnIndex(cell: HTMLElement): number | null {
    const row = cell.closest('tr');
    if (!row) {
      return null;
    }

    let columnIndex = 0;
    for (const candidate of Array.from(row.cells)) {
      if (candidate === cell) {
        return columnIndex;
      }
      columnIndex += Math.max(1, candidate.colSpan);
    }

    return null;
  }

  private syncDeleteHandleVisibility(): void {
    const deleteTargets = this.handleLayer.querySelectorAll<HTMLElement>(
      '.pm-table-node__handle-target[data-handle-action="delete"]',
    );

    for (const target of deleteTargets) {
      const index = Number.parseInt(target.dataset.handleIndex ?? '', 10);
      const isVisible =
        target.dataset.handleKind === 'row'
          ? index === this.hoveredRowIndex
          : index === this.hoveredColumnIndex;
      target.classList.toggle(
        'pm-table-node__handle-target--visible',
        isVisible,
      );
    }
  }
}
