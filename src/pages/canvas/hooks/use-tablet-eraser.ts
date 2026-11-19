import { useEffect } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { listen } from '@tauri-apps/api/event';

/**
 * Applies the drawing-tablet eraser state that Rust reads from macOS proximity events (the
 * webview reports the pen as a plain mouse). Emitted only on macOS.
 */
export function useTabletEraser(
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>,
) {
  useEffect(() => {
    const unlisten = listen<boolean>('tablet-eraser', (event) => {
      drawableCanvasRef.current?.setTabletEraser(event.payload);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [drawableCanvasRef]);
}
