import { useEffect, useRef, useState } from 'react';
import { Bold, Code, Italic, Strikethrough, Underline } from 'lucide-react';
import { toggleMark } from 'prosemirror-commands';
import type { MarkType } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { type Action, formatKeyCombo, registry } from '@/lib/keybinds';
import { PM_UPDATE_EVENT } from './constants';
import { schema } from './schema';

interface FloatingToolbarProps {
  view: EditorView;
}

interface ToolbarPosition {
  x: number;
  y: number;
  visible: boolean;
}

interface MarkButton {
  mark: MarkType;
  icon: React.FC<{ className?: string }>;
  label: string;
  action: Action;
}

const TYPOGRAPHY_MARKS: MarkButton[] = [
  { mark: schema.marks.bold, icon: Bold, label: 'Bold', action: 'editor:bold' },
  {
    mark: schema.marks.italic,
    icon: Italic,
    label: 'Italic',
    action: 'editor:italic',
  },
  {
    mark: schema.marks.underline,
    icon: Underline,
    label: 'Underline',
    action: 'editor:underline',
  },
  {
    mark: schema.marks.strikethrough,
    icon: Strikethrough,
    label: 'Strikethrough',
    action: 'editor:strikethrough',
  },
];

const STRUCTURAL_MARKS: MarkButton[] = [
  { mark: schema.marks.code, icon: Code, label: 'Code', action: 'editor:code' },
];

const ALL_MARKS = [...TYPOGRAPHY_MARKS, ...STRUCTURAL_MARKS];

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
      for (const { mark } of ALL_MARKS) {
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

      const toolbarWidth = toolbarRef.current?.offsetWidth ?? 220;
      const x = rect.left + rect.width / 2 - toolbarWidth / 2;
      const y = rect.top - 52;

      setPos({ x, y, visible: true });
    }

    // pm-update fires after every ProseMirror transaction — this is the
    // single source of truth for both mark state and selection changes.
    const onUpdate = () => requestAnimationFrame(syncState);
    view.dom.addEventListener(PM_UPDATE_EVENT, onUpdate);

    // selectionchange covers browser-driven selection (drag-select, etc.)
    // that may not go through dispatchTransaction.
    const onSelectionChange = () => requestAnimationFrame(syncState);
    document.addEventListener('selectionchange', onSelectionChange);

    // Hide on any click that lands outside both the editor and the toolbar.
    // PM keeps its selection state across blur, and browsers keep the visual
    // text selection alive when focus moves to a non-editable element — so
    // syncState's range-change check alone won't catch "click somewhere else
    // on the page". Capture phase so we run before element-level handlers.
    const onOutsidePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) {
        return;
      }
      if (toolbarRef.current?.contains(target)) {
        return;
      }
      if (view.dom.contains(target)) {
        return;
      }
      lastSelRange.current = null;
      setPos((p) => (p.visible ? { ...p, visible: false } : p));
    };
    document.addEventListener('pointerdown', onOutsidePointerDown, true);

    return () => {
      view.dom.removeEventListener(PM_UPDATE_EVENT, onUpdate);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
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

  const renderButton = ({ mark, icon: Icon, label, action }: MarkButton) => {
    const active = activeMarks.has(mark);
    const combo = registry.getCombo(action);
    return (
      <Tooltip key={label}>
        <TooltipTrigger
          type="button"
          onClick={() => handleToggleMark(mark)}
          className={`flex size-8 cursor-pointer items-center justify-center rounded-lg border-none transition-colors duration-100 ${
            active
              ? 'bg-gradient-to-b from-accent-dark to-primary-container text-text-on-dark'
              : 'bg-transparent text-text-secondary hover:bg-hover-tint hover:text-text-primary'
          }`}
        >
          <Icon className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          <span>{label}</span>
          {combo && (
            <kbd
              data-slot="kbd"
              className="ml-1 rounded bg-white/10 px-1.5 py-0.5 font-medium text-[10px] text-white/80"
            >
              {formatKeyCombo(combo)}
            </kbd>
          )}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delay={250}>
      <div
        ref={toolbarRef}
        className="fade-in-0 zoom-in-95 slide-in-from-bottom-1 fixed z-50 flex animate-in items-center gap-2 rounded-xl bg-card/80 px-1.5 py-1 shadow-ambient backdrop-blur-[24px] duration-150"
        style={{
          left: pos.x,
          top: pos.y,
          border: '0.5px solid var(--border-ghost)',
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-0.5">
          {TYPOGRAPHY_MARKS.map(renderButton)}
        </div>
        <div className="flex items-center gap-0.5">
          {STRUCTURAL_MARKS.map(renderButton)}
        </div>
      </div>
    </TooltipProvider>
  );
}
