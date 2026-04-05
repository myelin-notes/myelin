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

function isMarkActive(state: EditorView['state'], markType: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) {
    return !!markType.isInSet(state.storedMarks ?? $from.marks());
  }
  return state.doc.rangeHasMark(from, to, markType);
}

export function FloatingToolbar({ view }: FloatingToolbarProps) {
  const [pos, setPos] = useState<ToolbarPosition>({
    x: 0,
    y: 0,
    visible: false,
  });
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Snapshot of active marks — drives button highlighting.
  const [activeMarks, setActiveMarks] = useState<Set<MarkType>>(new Set());
  // Track PM selection range so we only reposition when it changes,
  // not when marks toggle on the same range (which changes text size).
  const lastSelRange = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    function syncState() {
      const { selection } = view.state;

      // Update active marks on every state change.
      const nextActive = new Set<MarkType>();
      for (const { mark } of MARK_BUTTONS) {
        if (isMarkActive(view.state, mark)) {
          nextActive.add(mark);
        }
      }
      setActiveMarks(nextActive);

      // Hide when nothing is selected.
      if (selection.empty) {
        lastSelRange.current = null;
        setPos((p) => (p.visible ? { ...p, visible: false } : p));
        return;
      }

      // Skip repositioning if only marks changed on the same range.
      const prev = lastSelRange.current;
      const rangeChanged =
        !prev || prev.from !== selection.from || prev.to !== selection.to;
      lastSelRange.current = { from: selection.from, to: selection.to };
      if (!rangeChanged) {
        return;
      }

      // Reposition above the DOM selection.
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

    // pm-update fires after every ProseMirror transaction — this is the
    // single source of truth for both mark state and selection changes.
    const onUpdate = () => requestAnimationFrame(syncState);
    view.dom.addEventListener('pm-update', onUpdate);

    // selectionchange covers browser-driven selection (drag-select, etc.)
    // that may not go through dispatchTransaction.
    const onSelectionChange = () => requestAnimationFrame(syncState);
    document.addEventListener('selectionchange', onSelectionChange);

    return () => {
      view.dom.removeEventListener('pm-update', onUpdate);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [view]);

  const handleToggleMark = (markType: MarkType) => {
    const cmd = toggleMark(markType);
    cmd(view.state, view.dispatch);
    view.focus();
    // No forceRender needed — dispatchTransaction emits pm-update,
    // which triggers syncState above.
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
      {MARK_BUTTONS.map(({ mark, icon: Icon, label }) => (
        <button
          key={label}
          type="button"
          className={`flex size-7 items-center justify-center rounded-md transition-colors ${
            activeMarks.has(mark)
              ? 'bg-accent-dark/10 text-accent-dark'
              : 'text-text-secondary hover:bg-hover-tint'
          }`}
          onClick={() => handleToggleMark(mark)}
          title={label}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
