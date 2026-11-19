import { useEffect } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { Logger } from '@myelin/shared/logger';
import { listen } from '@tauri-apps/api/event';

const logger = new Logger('TabletEraser'); // TEMP diagnostics

/**
 * Applies the drawing-tablet eraser state that Rust reads from macOS proximity events (the
 * webview reports the pen as a plain mouse). Emitted only on macOS.
 */
export function useTabletEraser(
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>,
) {
  useEffect(() => {
    logger.info('listening'); // TEMP
    const unlisten = listen<boolean>('tablet-eraser', (event) => {
      logger.info('proximity', {
        eraser: event.payload,
        canvas: !!drawableCanvasRef.current,
      }); // TEMP
      drawableCanvasRef.current?.setTabletEraser(event.payload);
    });
    // TEMP: which pointer type/buttons the webview reports for tablet contacts.
    const onDown = (e: PointerEvent) =>
      logger.info('pointerdown', {
        type: e.pointerType,
        button: e.button,
        buttons: e.buttons,
        erasing: drawableCanvasRef.current?.penIsErasing,
      });
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      void unlisten.then((stop) => stop());
    };
  }, [drawableCanvasRef]);
}
