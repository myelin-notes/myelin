import { useEffect, useRef, useState } from 'react';
import { Bold, Code, Italic, Strikethrough, Underline } from 'lucide-react';
import { toggleMark } from 'prosemirror-commands';
import type { MarkType } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema';

interface FloatingToolbarProps {
  view: EditorView;
}

interface ToolbarPosition {
  x: number;
  y: number;
  visible: boolean;
}

const MARK_BUTTONS: {
  mark: MarkType;
  icon: React.FC<{ className?: string }>;
  label: string;
  shortcut: string;
}[] = [
  { mark: schema.marks.bold, icon: Bold, label: 'Bold', shortcut: '⌘B' },
  { mark: schema.marks.italic, icon: Italic, label: 'Italic', shortcut: '⌘I' },
  {
    mark: schema.marks.underline,
    icon: Underline,
    label: 'Underline',
    shortcut: '⌘U',
  },
  {
    mark: schema.marks.strikethrough,
    icon: Strikethrough,
    label: 'Strikethrough',
    shortcut: '⌘⇧S',
  },
  { mark: schema.marks.code, icon: Code, label: 'Code', shortcut: '⌘E' },
];

function isMarkActive(view: EditorView, markType: MarkType): boolean {
  const { from, $from, to, empty } = view.state.selection;
  if (empty) {
    return !!markType.isInSet(view.state.storedMarks ?? $from.marks());
  }
  return view.state.doc.rangeHasMark(from, to, markType);
}

export function FloatingToolbar({ view }: FloatingToolbarProps) {
  const [pos, setPos] = useState<ToolbarPosition>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [, forceRender] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  /** Track PM selection range to avoid repositioning on mark-only changes. */
  const lastSelRange = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    function updatePosition() {
      const { selection } = view.state;
      if (selection.empty) {
        lastSelRange.current = null;
        setPos((p) => (p.visible ? { ...p, visible: false } : p));
        return;
      }

      // Only recompute position when the selection range itself changes,
      // not when marks are toggled on the same range.
      const prev = lastSelRange.current;
      const rangeChanged =
        !prev || prev.from !== selection.from || prev.to !== selection.to;
      lastSelRange.current = { from: selection.from, to: selection.to };

      if (!rangeChanged) {
        // Marks changed but range didn't — keep current position, just re-render buttons.
        setPos((p) => (p.visible ? { ...p } : p));
        return;
      }

      const domSel = window.getSelection();
      if (!domSel || domSel.rangeCount === 0) {
        setPos((p) => (p.visible ? { ...p, visible: false } : p));
        return;
      }

      const range = domSel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPos((p) => (p.visible ? { ...p, visible: false } : p));
        return;
      }

      const toolbarWidth = toolbarRef.current?.offsetWidth ?? 200;
      const x = rect.left + rect.width / 2 - toolbarWidth / 2;
      const y = rect.top - 44;

      setPos({ x, y, visible: true });
    }

    const onSelectionChange = () => requestAnimationFrame(updatePosition);
    document.addEventListener('selectionchange', onSelectionChange);

    const onPointerUp = () => requestAnimationFrame(updatePosition);
    document.addEventListener('pointerup', onPointerUp);

    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerup', onPointerUp);
    };
  }, [view]);

  const handleToggleMark = (markType: MarkType) => {
    const cmd = toggleMark(markType);
    cmd(view.state, view.dispatch);
    view.focus();
    forceRender((n) => n + 1);
  };

  if (!pos.visible) {
    return null;
  }

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg bg-white/90 px-1 py-0.5 shadow-ambient backdrop-blur-[24px]"
      style={{
        left: pos.x,
        top: pos.y,
        border: '0.5px solid rgba(195, 199, 202, 0.25)',
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {MARK_BUTTONS.map(({ mark, icon: Icon, label }) => {
        const active = isMarkActive(view, mark);
        return (
          <button
            key={label}
            type="button"
            className={`flex size-7 items-center justify-center rounded-md transition-colors ${
              active
                ? 'bg-accent-dark/10 text-accent-dark'
                : 'text-text-secondary hover:bg-hover-tint'
            }`}
            onClick={() => handleToggleMark(mark)}
            title={label}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
