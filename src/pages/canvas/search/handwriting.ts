import { useEffect } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { StrokeElement } from '@myelin/editor/elements/stroke-element';
import { Logger } from '@myelin/shared/logger';
import type { NativeRepository, VFSNodeId } from '@/lib/sync';
import {
  type HandwritingStroke,
  recognizeHandwriting,
} from '@/platform/tauri/handwriting';
import type { CanvasSearchRect, CanvasSearchSource } from './collect';

const logger = new Logger('HandwritingSearch');

// A pause mid-line only costs one extra recognition: the next stroke changes the block's key.
const BACKGROUND_IDLE_MS = 3_000;

// Strokes closer than these multiples of the median stroke height share a block: joins letters,
// words and the lines of a paragraph, while a blank line or separate note starts a new block. Word
// gaps can exceed a letter's height (finger-written "Hello Josh" split in two at 1x), hence wider.
const WORD_GAP_RATIO = 3;
const LINE_GAP_RATIO = 1;

function groupNearbyStrokes(strokes: StrokeElement[]): StrokeElement[][] {
  const boxes = strokes.map((stroke) => stroke.boundingBox);
  const heights = boxes.map((box) => box.height).sort((a, b) => a - b);
  const median = heights[heights.length >> 1] ?? 0;
  const across = median * WORD_GAP_RATIO;
  const down = median * LINE_GAP_RATIO;

  const parent = strokes.map((_, index) => index);
  const root = (start: number): number => {
    let index = start;
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const byLeft = strokes
    .map((_, index) => index)
    .sort((a, b) => boxes[a].left - boxes[b].left);
  for (let i = 0; i < byLeft.length; i++) {
    const a = boxes[byLeft[i]];
    for (let j = i + 1; j < byLeft.length; j++) {
      const b = boxes[byLeft[j]];
      if (b.left > a.right + across) {
        break;
      }
      if (b.top <= a.bottom + down && a.top <= b.bottom + down) {
        parent[root(byLeft[i])] = root(byLeft[j]);
      }
    }
  }

  const groups = new Map<number, StrokeElement[]>();
  strokes.forEach((stroke, index) => {
    const key = root(index);
    const group = groups.get(key);
    if (group) {
      group.push(stroke);
    } else {
      groups.set(key, [stroke]);
    }
  });
  return [...groups.values()];
}

function toWorldStroke(stroke: StrokeElement): HandwritingStroke {
  return {
    points: stroke.xyPoints.flatMap(([x, y]) => {
      const world = stroke.localToWorld(x, y);
      return [world.x, world.y];
    }),
    width: stroke.strokeStyle.size * Math.abs(stroke.scale.x),
  };
}

function unionRect(strokes: StrokeElement[]): CanvasSearchRect {
  const boxes = strokes.map((stroke) => stroke.boundingBox);
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

interface HandwritingBlock {
  members: StrokeElement[];
  key: string;
}

type HandwritingStore = Pick<
  NativeRepository,
  'loadHandwritingText' | 'saveHandwritingText'
>;

/** One canvas's recognized text, saved on this device so only new or edited blocks are recognized. */
export class HandwritingIndex {
  // By block key: member uuids + point counts, so edits re-recognize but moves don't.
  private texts: Promise<Map<string, string>> | null = null;
  private readonly recognizing = new Map<string, Promise<void>>();
  private warned = false;

  constructor(
    private readonly store: HandwritingStore,
    private readonly noteId: VFSNodeId,
  ) {}

  /**
   * One source per block of ink with recognized text. `onSources` gets the saved blocks at once,
   * then each new block as it's recognized.
   */
  async collect(
    dc: DrawableCanvas,
    onSources: (sources: CanvasSearchSource[]) => void = () => {},
  ): Promise<CanvasSearchSource[]> {
    const texts = await this.load();
    const strokes = dc.elements.filter(
      (element): element is StrokeElement => element instanceof StrokeElement,
    );
    const blocks = groupNearbyStrokes(strokes).map((members) => ({
      members,
      key: members
        .map((stroke) => `${stroke.uuid}:${stroke.xyPoints.length}`)
        .sort()
        .join(','),
    }));

    const sources: CanvasSearchSource[] = [];
    const emit = (found: HandwritingBlock[]) => {
      const batch = found.flatMap(({ members, key }) => {
        const text = texts.get(key);
        return text
          ? [
              {
                kind: 'handwriting' as const,
                rect: unionRect(members),
                selectUuids: members.map((stroke) => stroke.uuid),
                text,
              },
            ]
          : [];
      });
      if (batch.length > 0) {
        sources.push(...batch);
        onSources(batch);
      }
    };
    const pending = blocks.filter((block) => !texts.has(block.key));
    emit(blocks.filter((block) => texts.has(block.key)));

    let changed = false;
    for (const block of pending) {
      try {
        await this.recognize(texts, block);
      } catch (error) {
        // Once per canvas: platforms without a recognizer fail every background pass.
        if (!this.warned) {
          this.warned = true;
          logger.warn('Handwriting recognition failed', error);
        }
        break;
      }
      changed = true;
      emit([block]);
    }
    // Edited and erased blocks leave stale keys behind.
    const live = new Set(blocks.map((block) => block.key));
    for (const key of texts.keys()) {
      if (!live.has(key)) {
        texts.delete(key);
        changed = true;
      }
    }
    if (changed) {
      await this.store
        .saveHandwritingText(this.noteId, Object.fromEntries(texts))
        .catch((error) => logger.warn('Could not save handwriting', error));
    }
    return sources;
  }

  // Shared per block, so a second pass over the same ink waits on the first's call.
  private recognize(
    texts: Map<string, string>,
    { members, key }: HandwritingBlock,
  ): Promise<void> {
    if (texts.has(key)) {
      return Promise.resolve();
    }
    let call = this.recognizing.get(key);
    if (!call) {
      call = recognizeHandwriting([members.map(toWorldStroke)])
        .then(([text]) => {
          texts.set(key, text);
        })
        .finally(() => this.recognizing.delete(key));
      this.recognizing.set(key, call);
    }
    return call;
  }

  private load(): Promise<Map<string, string>> {
    this.texts ??= this.store.loadHandwritingText(this.noteId).then(
      (saved) => new Map(Object.entries(saved)),
      (error) => {
        logger.warn('Could not load saved handwriting', error);
        return new Map();
      },
    );
    return this.texts;
  }
}

/** Recognizes new ink once the canvas has been still a while, so library search can find it. */
export function useBackgroundHandwriting(
  dc: DrawableCanvas | null,
  handwriting: HandwritingIndex,
): void {
  useEffect(() => {
    if (!dc) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => void handwriting.collect(dc),
        BACKGROUND_IDLE_MS,
      );
    };
    schedule();
    dc.ydoc.elements.observeDeep(schedule);
    return () => {
      clearTimeout(timer);
      dc.ydoc.elements.unobserveDeep(schedule);
    };
  }, [dc, handwriting]);
}
