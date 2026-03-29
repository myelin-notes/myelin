import type { TextEditState } from '../hooks/use-canvas-engine';

interface TextEditOverlayProps {
  textEdit: TextEditState;
  onDismiss: () => void;
}

export function TextEditOverlay({ textEdit, onDismiss }: TextEditOverlayProps) {
  return (
    <textarea
      autoFocus
      defaultValue={textEdit.initialText}
      className="absolute z-20 m-0 resize-none overflow-hidden border-none bg-transparent p-0 caret-accent-dark outline-none"
      style={{
        left: textEdit.screenPos.x,
        top: textEdit.screenPos.y,
        width: textEdit.boxScreenWidth,
        height: textEdit.boxScreenHeight,
        fontSize: textEdit.screenFontSize,
        lineHeight: 1.3,
        fontFamily: `"${textEdit.fontFamily}", sans-serif`,
        color: 'var(--text-primary)',
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        whiteSpace: 'pre-wrap',
      }}
      onBlur={(e) => {
        textEdit.onCommit(e.currentTarget.value);
        onDismiss();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.blur();
          onDismiss();
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          textEdit.onCommit(e.currentTarget.value);
          onDismiss();
        }
      }}
    />
  );
}
