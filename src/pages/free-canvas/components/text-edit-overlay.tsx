import { useRef } from 'react';
import { EditTextCommand } from '../commands/edit-text';
import type { DrawableCanvas } from '../drawable-canvas';
import type { TextElement } from '../elements/text-element';

interface TextEditOverlayProps {
  element: TextElement;
  canvas: DrawableCanvas;
  onDismiss: () => void;
}

export function TextEditOverlay({
  element,
  canvas,
  onDismiss,
}: TextEditOverlayProps) {
  const oldTextRef = useRef(element.text);
  const zoom = canvas.zoom;
  const screenPos = canvas.worldToScreen({
    x: element.boundingBox.x,
    y: element.boundingBox.y,
  });

  const commit = (text: string) => {
    const oldText = oldTextRef.current;
    if (!text.trim()) {
      canvas.removeElement(element);
    } else if (text !== oldText) {
      element.setText(text);
      element.updateBounds();
      canvas.pushApplied(new EditTextCommand(element, oldText, text));
    }
    canvas.updateBounding();
    onDismiss();
  };

  return (
    <textarea
      autoFocus
      defaultValue={element.text}
      className="absolute z-20 m-0 resize-none overflow-hidden border-none bg-transparent p-0 caret-accent-dark outline-none"
      style={{
        left: screenPos.x,
        top: screenPos.y,
        width: element.boxWidth * zoom,
        height: element.boxHeight * zoom,
        fontSize: element.style.fontSize * zoom,
        lineHeight: 1.3,
        fontFamily: `"${element.style.fontFamily}", sans-serif`,
        color: 'var(--text-primary)',
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        whiteSpace: 'pre-wrap',
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.blur();
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commit(e.currentTarget.value);
        }
      }}
    />
  );
}
