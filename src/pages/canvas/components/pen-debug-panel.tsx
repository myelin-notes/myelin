import { useEffect, useRef, useState } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';

/**
 * Temporary diagnostic overlay for stylus buttons.
 *
 * Prints every pointer event whose button state changed, interleaved with what
 * the native shim saw before the WebView got hold of it (`nat` lines, pushed
 * through window.__stylusNative from MainActivity). Between the two, a tester
 * on a device we can't attach a debugger to can screenshot both halves of the
 * handoff. Delete once the S Pen barrel button is confirmed working.
 */

const BUTTON_BITS: ReadonlyArray<[number, string]> = [
  [1, 'tip'],
  [2, 'barrel'],
  [4, 'mid'],
  [8, 'x1'],
  [16, 'x2'],
  [32, 'eraser'],
];

function describeButtons(buttons: number): string {
  if (buttons === 0) {
    return 'none';
  }
  return BUTTON_BITS.filter(([bit]) => buttons & bit)
    .map(([, name]) => name)
    .join('+');
}

const MAX_LINES = 14;

interface StylusNativeWindow extends Window {
  __stylusNative?: (line: string) => void;
}

interface PenDebugPanelProps {
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>;
}

export function PenDebugPanel({ drawableCanvasRef }: PenDebugPanelProps) {
  const [lines, setLines] = useState<Array<{ id: number; text: string }>>([]);
  const [live, setLive] = useState('waiting for input');
  const lastSignature = useRef<string | null>(null);
  const lastAt = useRef<number | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    const push = (source: string, body: string) => {
      const now = Date.now();
      const gap =
        lastAt.current === null
          ? 'start'
          : `+${Math.min(now - lastAt.current, 9999)}ms`;
      lastAt.current = now;
      nextId.current += 1;
      const entry = {
        id: nextId.current,
        text: `${gap.padStart(7)} ${source.padEnd(5)} ${body}`,
      };
      setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), entry]);
    };

    const record = (event: PointerEvent | MouseEvent) => {
      const pointerType =
        'pointerType' in event ? event.pointerType || '?' : 'ctx';
      const { type, button, buttons } = event;
      const signature = `${pointerType}:${type}:${button}:${buttons}`;
      // Moves flood at 120Hz, so only the ones that changed something are
      // worth a line — which is exactly where a button press shows up.
      if (type === 'pointermove' && lastSignature.current === signature) {
        return;
      }
      lastSignature.current = signature;

      const canvas = drawableCanvasRef.current;
      const tool = canvas
        ? `${canvas.activeToolId}${canvas.penIsErasing ? '*' : ''}`
        : '?';
      const label = type.replace('pointer', 'p.');
      // Pressure separates a hovering pen from a touching one.
      const pressure = 'pressure' in event ? event.pressure.toFixed(2) : '----';
      push(
        pointerType,
        `${label.padEnd(9)} bs=${buttons} p=${pressure} ${describeButtons(buttons)} [${tool}]`,
      );
      setLive(`${pointerType} ${describeButtons(buttons)} → ${tool}`);
    };

    // Capture phase, so the reading is of what the browser delivered rather
    // than what the canvas handlers left behind.
    const options = { capture: true } as const;
    const types = [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
    ] as const;
    for (const type of types) {
      window.addEventListener(type, record as EventListener, options);
    }
    window.addEventListener('contextmenu', record as EventListener, options);

    const host = window as StylusNativeWindow;
    host.__stylusNative = (line: string) => {
      push('nat', line);
    };

    return () => {
      for (const type of types) {
        window.removeEventListener(type, record as EventListener, options);
      }
      window.removeEventListener(
        'contextmenu',
        record as EventListener,
        options,
      );
      host.__stylusNative = undefined;
    };
  }, [drawableCanvasRef]);

  return (
    <div
      className="pointer-events-none absolute top-16 left-2 max-w-[min(28rem,calc(100vw-1rem))] rounded-lg bg-black/80 px-2 py-1.5 font-mono text-[10px] text-green-300 leading-tight"
      style={{ zIndex: 200 }}
    >
      <div className="mb-1 text-white">pen debug — {live}</div>
      {lines.map((line) => (
        <div key={line.id} className="whitespace-pre">
          {line.text}
        </div>
      ))}
    </div>
  );
}
