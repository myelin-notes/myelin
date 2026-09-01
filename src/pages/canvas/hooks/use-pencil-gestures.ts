import { useEffect, useEffectEvent, useRef } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { ITool } from '@myelin/editor/tools/tool';
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import type { WheelPickerHandle } from '@/components/wheel-picker';
import { MOBILE_PLATFORM } from '@/lib/env';

/**
 * Emitted by tauri-plugin-pencil; `action` is the user's system-wide Apple
 * Pencil setting, already resolved on the native side.
 */
interface PencilGesture {
  kind: 'doubleTap' | 'squeeze';
  action:
    | 'switchEraser'
    | 'switchPrevious'
    | 'showColorPalette'
    | 'showInkAttributes'
    | 'showContextualPalette';
  /** Hover location in webview points; absent when the pencil is out of hover range. */
  x?: number;
  y?: number;
}

interface UsePencilGesturesArgs {
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>;
  wheelRef: React.RefObject<WheelPickerHandle | null>;
  canvasTools: ITool[];
  selectedToolIndex: number;
  toggleOptions: () => void;
}

/**
 * Maps Apple Pencil hardware gestures (double-tap, squeeze) onto the tool
 * system, honoring whatever action the user picked in iOS Settings. No-op off
 * iOS. Switches go through `switchTool` like the keyboard shortcuts, so the
 * options panel doesn't pop open on a toggle.
 */
export function usePencilGestures({
  drawableCanvasRef,
  wheelRef,
  canvasTools,
  selectedToolIndex,
  toggleOptions,
}: UsePencilGesturesArgs) {
  // The barrel-button eraser override bypasses switchTool, so holding the pen
  // flipped never becomes the "last used tool".
  const lastToolRef = useRef(selectedToolIndex);
  const previousToolRef = useRef<number | null>(null);
  if (lastToolRef.current !== selectedToolIndex) {
    previousToolRef.current = lastToolRef.current;
    lastToolRef.current = selectedToolIndex;
  }

  const handleGesture = useEffectEvent((gesture: PencilGesture) => {
    const canvas = drawableCanvasRef.current;
    if (!canvas) {
      return;
    }
    switch (gesture.action) {
      case 'switchEraser': {
        const eraser = canvasTools.findIndex((tool) => tool.id === 'eraser');
        const back =
          previousToolRef.current ??
          canvasTools.findIndex((tool) => tool.id === 'pen');
        const target = selectedToolIndex === eraser ? back : eraser;
        if (target >= 0) {
          canvas.switchTool(target);
        }
        break;
      }
      case 'switchPrevious': {
        if (previousToolRef.current != null) {
          canvas.switchTool(previousToolRef.current);
        }
        break;
      }
      case 'showColorPalette':
      case 'showInkAttributes':
        toggleOptions();
        break;
      case 'showContextualPalette': {
        const wheel = wheelRef.current;
        if (!wheel) {
          break;
        }
        if (wheel.isVisible()) {
          wheel.hide();
          break;
        }
        // A squeeze can land mid-stroke; throw away whatever is in flight,
        // matching the press-and-hold path in use-page-canvas-bindings.
        canvas.abortInteraction();
        // Native points → client CSS px: the tablet build zooms the layout
        // viewport (see applyMobileViewportScale), which visualViewport reports.
        const scale = window.visualViewport?.scale ?? 1;
        wheel.show({
          clientX:
            gesture.x != null ? gesture.x / scale : window.innerWidth / 2,
          clientY:
            gesture.y != null ? gesture.y / scale : window.innerHeight / 2,
        });
        break;
      }
    }
  });

  useEffect(() => {
    if (MOBILE_PLATFORM !== 'ios') {
      return;
    }
    let disposed = false;
    let listener: PluginListener | null = null;
    void addPluginListener<PencilGesture>('pencil', 'gesture', (gesture) => {
      handleGesture(gesture);
    }).then((l) => {
      if (disposed) {
        void l.unregister();
      } else {
        listener = l;
      }
    });
    // TEMP: native touch probe, see PencilPlugin.swift. Remove with it.
    let probe: PluginListener | null = null;
    void addPluginListener<{ line: string }>('pencil', 'touchprobe', (e) => {
      console.log(`[ptr] native ${e.line}`);
    }).then((l) => {
      if (disposed) {
        void l.unregister();
      } else {
        probe = l;
      }
    });
    return () => {
      disposed = true;
      void listener?.unregister();
      void probe?.unregister();
    };
  }, []);
}
