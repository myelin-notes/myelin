import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { PageFrameElement } from '../../elements/page-frame-element';
import { PM_ADD_TO_HISTORY } from '../pm/constants';
import { schema } from '../pm/schema';

export const BAND_NODE = 'canvasBand';

export interface BandLocation {
  pos: number;
  node: PMNode;
}

/**
 * Band edits never enter the editor's undo stack: the ink that gives a band its meaning is undone
 * by the *canvas* history, so a text undo that removed the band alone would strand its strokes.
 * Bands left without ink are reclaimed by the sweep instead.
 */
function dispatchBandChange(view: EditorView, tr: Transaction): void {
  tr.setMeta(PM_ADD_TO_HISTORY, false);
  view.dispatch(tr);
}

export function findBand(doc: PMNode, bandId: string): BandLocation | null {
  let found: BandLocation | null = null;
  doc.forEach((node, pos) => {
    if (
      found === null &&
      node.type.name === BAND_NODE &&
      node.attrs.bandId === bandId
    ) {
      found = { pos, node };
    }
  });
  return found;
}

export function insertBand(
  view: EditorView,
  pos: number,
  height: number,
): string {
  const bandId = crypto.randomUUID();
  const tr = view.state.tr.insert(
    pos,
    schema.nodes[BAND_NODE].create({ bandId, height }),
  );
  dispatchBandChange(view, tr);
  return bandId;
}

export function setBandHeight(
  view: EditorView,
  bandId: string,
  height: number,
): void {
  const found = findBand(view.state.doc, bandId);
  if (!found || found.node.attrs.height === height) {
    return;
  }
  dispatchBandChange(
    view,
    view.state.tr.setNodeMarkup(found.pos, undefined, {
      ...found.node.attrs,
      height,
    }),
  );
}

/** Removes back-to-front so each deletion leaves the earlier positions valid. */
export function removeBands(
  view: EditorView,
  bandIds: ReadonlySet<string>,
): void {
  const targets: BandLocation[] = [];
  view.state.doc.forEach((node, pos) => {
    if (node.type.name === BAND_NODE && bandIds.has(node.attrs.bandId)) {
      targets.push({ pos, node });
    }
  });
  if (targets.length === 0) {
    return;
  }
  const tr = view.state.tr;
  for (let i = targets.length - 1; i >= 0; i--) {
    const { pos, node } = targets[i];
    tr.delete(pos, pos + node.nodeSize);
  }
  dispatchBandChange(view, tr);
}

export function listBandIds(doc: PMNode): string[] {
  const ids: string[] = [];
  doc.forEach((node) => {
    if (node.type.name === BAND_NODE) {
      ids.push(node.attrs.bandId);
    }
  });
  return ids;
}

export function findBandDom(
  frame: PageFrameElement,
  bandId: string,
): HTMLElement | null {
  return (
    frame.contentDiv?.querySelector<HTMLElement>(
      `.pm-canvas-band[data-band-id="${CSS.escape(bandId)}"]`,
    ) ?? null
  );
}
