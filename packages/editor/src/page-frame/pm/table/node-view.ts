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

const DEFAULT_CELL_MIN_WIDTH = 120;
const HANDLE_HOVER_STRIP_THICKNESS = 14;

export class PageFrameTableNodeView implements NodeView {
  public readonly dom: HTMLDivElement;
  public readonly contentDOM: HTMLTableSectionElement;

  private readonly tableView: TableView;
  private readonly handleLayer: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver | null;
  private pendingRenderFrame = 0;
  private hoveredRowIndex: number | null = null;
  private hoveredColumnIndex: number | null = null;

  constructor(
    node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number,
  ) {
    this.tableView = new TableView(node, DEFAULT_CELL_MIN_WIDTH);
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

    this.scheduleHandleRender();
  }

  update(node: PMNode): boolean {
    if (!this.tableView.update(node)) {
      return false;
    }

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
