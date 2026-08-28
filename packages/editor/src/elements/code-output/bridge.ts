import type { DrawableCanvas } from '../../drawable-canvas';
import type { PageFramePmScreenRect } from '../../page-frame/pm/screen-rect';
import { ElementType } from '../element-type';
import {
  CodeOutputElement,
  type CodeOutputItem,
  type CodeOutputRunMeta,
} from './element';

/** World-px gap between the page frame's edge and a freshly spawned card. */
const SPAWN_GAP = 24;

export interface EnsureCardRequest {
  frameUuid: string;
  blockId: string;
  /** The block's on-screen rect at run time (client px), for the initial spawn position. */
  blockScreenRect: PageFramePmScreenRect | null;
  pageLayout: string;
}

export interface SettleRunRequest {
  frameUuid: string;
  blockId: string;
  items: CodeOutputItem[];
  runMeta: CodeOutputRunMeta;
  truncated: number;
}

/**
 * Connects code-block run buttons (vanilla PM node views with no canvas access) to the active
 * {@link DrawableCanvas} so runs can spawn/settle their output card elements. The app registers
 * the canvas on session attach and clears it on teardown; with none registered, runs still
 * stream to the store — there is just no card to show them.
 */
class CodeOutputBridge {
  private canvas: DrawableCanvas | null = null;

  registerCanvas(canvas: DrawableCanvas | null): void {
    this.canvas = canvas;
  }

  /** Spawn the card for this block if it doesn't exist yet. Re-runs reuse the existing card. */
  ensureCard(req: EnsureCardRequest): void {
    const canvas = this.canvas;
    if (!canvas || this.findCard(req.frameUuid, req.blockId)) {
      return;
    }

    const frame = canvas.getElementByUuid(req.frameUuid);
    const rect = req.blockScreenRect;
    if (!frame || !rect) {
      return;
    }
    const frameBox = frame.boundingBox;
    const blockTopLeft = canvas.viewport.getPoint({
      clientX: rect.left,
      clientY: rect.top,
    });

    // Each layout leaves an empty canvas band opposite its stacking axis: vertical/continuous
    // stack downward (room on the side), horizontal steps sideways (room below). Initial value
    // only — an attached card re-derives this from the block's rect every frame.
    const position =
      req.pageLayout === 'horizontal'
        ? { x: blockTopLeft.x, y: frameBox.bottom + SPAWN_GAP }
        : { x: frameBox.right + SPAWN_GAP, y: blockTopLeft.y };

    const card = canvas.addElement((uuid) => {
      const element = new CodeOutputElement(uuid, req.frameUuid, req.blockId);
      element.setOffset(position.x, position.y);
      return element;
    });
    card.updateBounds();
  }

  /** Persist a finished run into its card. No-op if the card was deleted mid-run. */
  settle(req: SettleRunRequest): void {
    this.findCard(req.frameUuid, req.blockId)?.setRunResult(
      req.items,
      req.runMeta,
      req.truncated,
    );
  }

  private findCard(
    frameUuid: string,
    blockId: string,
  ): CodeOutputElement | null {
    const canvas = this.canvas;
    if (!canvas) {
      return null;
    }
    for (const element of canvas.getElementsByType(ElementType.CODE_OUTPUT)) {
      const card = element as CodeOutputElement;
      if (card.frameUuid === frameUuid && card.blockId === blockId) {
        return card;
      }
    }
    return null;
  }
}

export const codeOutputBridge = new CodeOutputBridge();
