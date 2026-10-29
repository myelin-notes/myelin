import { Flag } from 'lucide-react';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import { FlagElement } from '../elements/flag-element';
import { PageFrameElement } from '../elements/page-frame-element';
import { PdfElement } from '../elements/pdf';
import type { MessageGetter } from '../i18n';
import { pageContainsPoint } from '../page-frame/anchoring';
import { CollisionHelper } from '../utils/collision-helper';
import type { ITool, SvgIcon, ToolId, ToolOption } from './tool';

const CLICK_THRESHOLD = 5;

function headingAbove(
  frame: PageFrameElement,
  event: PointerEvent,
): string | null {
  const view = frame.pmEditor?.view;
  const pos = view?.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!view || !pos) {
    return null;
  }
  let heading: string | null = null;
  view.state.doc.nodesBetween(0, pos.pos, (node) => {
    if (node.type.name === 'heading' && node.textContent.trim()) {
      heading = node.textContent.trim();
    }
    return !node.isTextblock;
  });
  return heading;
}

export class FlagTool implements ITool {
  private down: { point: Vector2; event: PointerEvent } | null = null;
  private flagTypeId = '';

  public constructor(private readonly getStrings: MessageGetter) {}

  get id(): ToolId {
    return 'flag';
  }

  start(canvas: DrawableCanvas, event: PointerEvent): void {
    this.down = { point: canvas.viewport.getPoint(event), event };
  }

  update(): void {}

  finish(canvas: DrawableCanvas, event: PointerEvent): void {
    const down = this.down;
    this.down = null;
    if (!down) {
      return;
    }
    const end = canvas.viewport.getPoint(event);
    const zoom = canvas.viewport.zoom;
    if (
      Math.abs(end.x - down.point.x) * zoom >= CLICK_THRESHOLD ||
      Math.abs(end.y - down.point.y) * zoom >= CLICK_THRESHOLD
    ) {
      return;
    }
    const { point } = down;
    const label = this.labelAt(canvas, point, down.event);
    const flagTypeId = canvas.resolveFlagType(this.flagTypeId)?.id ?? '';
    canvas.transact(() => {
      const flag = canvas.addElement((uuid) => {
        const element = new FlagElement(uuid, label, flagTypeId);
        element.setOffset(point.x, point.y);
        return element;
      });
      const frame = canvas.anchoring.findFrame(point);
      if (frame) {
        canvas.anchoring.attach(flag, frame, point);
      }
    });
  }

  // Top-most PDF page or page frame under the point names the flag; elsewhere it stays unnamed.
  private labelAt(
    canvas: DrawableCanvas,
    point: Vector2,
    event: PointerEvent,
  ): string {
    for (const element of [...canvas.elements].reverse()) {
      if (element.hidden) {
        continue;
      }
      if (element instanceof PdfElement) {
        for (let page = 0; page < element.pageCount; page++) {
          const bounds = element.getPageBounds(page);
          if (bounds && CollisionHelper.inBox(point, bounds)) {
            return this.getStrings().canvas.flags.pdfPage(
              element.fileName,
              page + 1,
            );
          }
        }
      } else if (
        element instanceof PageFrameElement &&
        pageContainsPoint(element, point)
      ) {
        return headingAbove(element, event) ?? element.displayName;
      }
    }
    return '';
  }

  interrupt(): void {
    this.down = null;
  }

  drawCursor(): void {}

  get icon(): SvgIcon {
    return Flag;
  }

  get label(): string {
    return this.getStrings().canvas.tools.flag;
  }

  getOptions(): ToolOption[] {
    return [
      {
        type: 'flag',
        key: 'flagType',
        label: this.getStrings().canvas.toolOptions.flagType,
        value: this.flagTypeId,
        set: (flagTypeId) => {
          this.flagTypeId = flagTypeId;
        },
      },
    ];
  }
}
