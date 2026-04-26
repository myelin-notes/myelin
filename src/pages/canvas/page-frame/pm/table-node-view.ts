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
} from './table-commands';

const DEFAULT_CELL_MIN_WIDTH = 120;
const HANDLE_HOVER_STRIP_THICKNESS = 14;

export class PageFrameTableNodeView implements NodeView {
  public readonly dom: HTMLDivElement;
  public readonly contentDOM: HTMLTableSectionElement;

  private readonly tableView: TableView;
  private readonly handleLayer: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver | null;
  private pendingRenderFrame = 0;

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

    let columnIndex = 0;
    for (const cell of Array.from(rows[0].cells)) {
      const cellRect = cell.getBoundingClientRect();
      const columnWidth = cellRect.width / Math.max(1, cell.colSpan);

      for (
        let spanIndex = 0;
        spanIndex < cell.colSpan;
        spanIndex += 1, columnIndex += 1
      ) {
        const boundaryScreenX = cellRect.left + columnWidth * (spanIndex + 1);
        const boundaryLeft = localXFromScreenX(boundaryScreenX);
        this.handleLayer.appendChild(
          this.createHandle({
            kind: 'column',
            index: columnIndex,
            targetLeft: boundaryLeft,
            targetTop: tableTop,
            targetWidth: HANDLE_HOVER_STRIP_THICKNESS,
            targetHeight: tableHeight,
            bubbleLeft: HANDLE_HOVER_STRIP_THICKNESS / 2,
            bubbleTop: tableCenterY - tableTop,
          }),
        );
      }
    }

    rows.forEach((row, rowIndex) => {
      this.handleLayer.appendChild(
        this.createHandle({
          kind: 'row',
          index: rowIndex,
          targetLeft: tableLeft,
          targetTop: localYFromScreenY(row.getBoundingClientRect().bottom),
          targetWidth: tableWidth,
          targetHeight: HANDLE_HOVER_STRIP_THICKNESS,
          bubbleLeft: tableCenterX - tableLeft,
          bubbleTop: HANDLE_HOVER_STRIP_THICKNESS / 2,
        }),
      );
    });
  }

  private createHandle(options: {
    kind: 'column' | 'row';
    index: number;
    targetLeft: number;
    targetTop: number;
    targetWidth: number;
    targetHeight: number;
    bubbleLeft: number;
    bubbleTop: number;
  }): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pm-table-node__handle-target pm-table-node__handle-target--${options.kind}`;
    button.setAttribute(
      'aria-label',
      options.kind === 'column' ? 'Add column after' : 'Add row after',
    );
    button.tabIndex = -1;
    button.style.left = `${options.targetLeft}px`;
    button.style.top = `${options.targetTop}px`;
    button.style.width = `${options.targetWidth}px`;
    button.style.height = `${options.targetHeight}px`;

    const bubble = document.createElement('span');
    bubble.className = `pm-table-node__handle pm-table-node__handle--${options.kind}`;
    bubble.setAttribute('aria-hidden', 'true');
    bubble.textContent = '+';
    bubble.style.left = `${options.bubbleLeft}px`;
    bubble.style.top = `${options.bubbleTop}px`;
    button.appendChild(bubble);

    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const tablePos = this.readTablePos();
      const tr =
        options.kind === 'column'
          ? buildAddTableColumnTransaction(
              this.view.state,
              tablePos,
              options.index,
            )
          : buildAddTableRowTransaction(
              this.view.state,
              tablePos,
              options.index,
            );

      this.view.dispatch(tr);
      this.view.focus();
    });

    return button;
  }
}
