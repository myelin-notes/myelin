import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import {
  type CanvasStyle,
  getCanvasStyle,
  hasCanvasStyleOverride,
  subscribeCanvasStyle,
} from '@myelin/editor/canvas-style';

interface CanvasStyleState {
  style: CanvasStyle;
  /** `true` when the canvas has its own style; always `false` for the global default. */
  overridden: boolean;
}

function readCanvasStyle(doc: Y.Doc | null): CanvasStyleState {
  return {
    style: getCanvasStyle(doc),
    overridden: doc !== null && hasCanvasStyleOverride(doc),
  };
}

/** `null` reads the global default. */
export function useCanvasStyle(doc: Y.Doc | null): CanvasStyleState {
  const [state, setState] = useState(() => readCanvasStyle(doc));
  useEffect(() => {
    const sync = () => setState(readCanvasStyle(doc));
    sync();
    return subscribeCanvasStyle(doc, sync);
  }, [doc]);
  return state;
}
