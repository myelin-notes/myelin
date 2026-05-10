import { createRef, forwardRef, useImperativeHandle, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { TextStyle } from './text-element';

interface TextEditOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TextEditOverlayOptions {
  initialText: string;
  rect: TextEditOverlayRect;
  textStyle: TextStyle;
  zoom: number;
  onSubmit: () => void;
}

export interface TextEditOverlayHandle {
  root: HTMLDivElement;
  focus: () => void;
  getValue: () => string;
  setTextStyle: (textStyle: TextStyle, zoom: number) => void;
  dispose: () => void;
}

interface TextEditOverlayViewHandle {
  focus: () => void;
  getValue: () => string;
}

export function createTextEditOverlay(
  options: TextEditOverlayOptions,
): TextEditOverlayHandle {
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'absolute',
    zIndex: '20',
    left: `${options.rect.left}px`,
    top: `${options.rect.top}px`,
    width: `${options.rect.width}px`,
    height: `${options.rect.height}px`,
  } as Partial<CSSStyleDeclaration>);

  const reactRoot = createRoot(root);
  const viewRef = createRef<TextEditOverlayViewHandle>();
  let currentTextStyle = options.textStyle;
  let currentZoom = options.zoom;
  let disposed = false;

  const render = () => {
    if (disposed) {
      return;
    }
    flushSync(() => {
      reactRoot.render(
        <TextEditOverlayView
          ref={viewRef}
          initialText={options.initialText}
          textStyle={currentTextStyle}
          zoom={currentZoom}
          onSubmit={options.onSubmit}
        />,
      );
    });
  };

  render();
  document.body.appendChild(root);

  return {
    root,
    focus: () => {
      viewRef.current?.focus();
    },
    getValue: () => viewRef.current?.getValue() ?? '',
    setTextStyle: (textStyle, zoom) => {
      currentTextStyle = textStyle;
      currentZoom = zoom;
      render();
    },
    dispose: () => {
      disposed = true;
      reactRoot.unmount();
      root.remove();
    },
  };
}

const TextEditOverlayView = forwardRef<
  TextEditOverlayViewHandle,
  {
    initialText: string;
    textStyle: TextStyle;
    zoom: number;
    onSubmit: () => void;
  }
>(function TextEditOverlayView(
  { initialText, textStyle, zoom, onSubmit },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        textareaRef.current?.focus();
      },
      getValue: () => textareaRef.current?.value ?? '',
    }),
    [],
  );

  return (
    <textarea
      ref={textareaRef}
      defaultValue={initialText}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onSubmit();
        }
      }}
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'block',
        fontSize: `${textStyle.fontSize * zoom}px`,
        lineHeight: `${textStyle.fontSize * 1.3 * zoom}px`,
        fontFamily: textStyle.fontFamily,
        color: textStyle.color,
        caretColor: 'var(--accent-dark)',
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        whiteSpace: 'pre-wrap',
        margin: 0,
        padding: 0,
        resize: 'none',
        overflow: 'hidden',
        border: 'none',
        background: 'transparent',
        outline: 'none',
      }}
    />
  );
});
