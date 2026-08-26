import {
  type CSSProperties,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Bold,
  ChevronDown,
  Italic,
  Strikethrough,
  Type,
  Underline,
} from 'lucide-react';
import { toggleMark } from 'prosemirror-commands';
import type { MarkType } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createPortal } from 'react-dom';
import { AddColorSwatch } from '../../components/add-color-swatch';
import { ColorSwatch } from '../../components/color-swatch';
import { CustomColorSwatch } from '../../components/custom-color-swatch';
import { useCustomColors } from '../../custom-colors';
import { PM_UPDATE_EVENT } from '../../events';
import { PEN_COLORS } from '../../tools/pen-tool';
import { schema } from './schema';
import { getPageFramePmScreenRectForPos } from './screen-rect';

interface FloatingToolbarProps {
  view: EditorView;
}

type ToggleMark = {
  key: string;
  icon: React.FC<{ className?: string }>;
  mark: MarkType;
  label: string;
};

const TOGGLE_MARKS: ToggleMark[] = [
  { key: 'bold', icon: Bold, mark: schema.marks.bold, label: 'Bold' },
  { key: 'italic', icon: Italic, mark: schema.marks.italic, label: 'Italic' },
  {
    key: 'underline',
    icon: Underline,
    mark: schema.marks.underline,
    label: 'Underline',
  },
  {
    key: 'strikethrough',
    icon: Strikethrough,
    mark: schema.marks.strikethrough,
    label: 'Strikethrough',
  },
];

const FONTS: { label: string; value: string | null }[] = [
  { label: 'Sans', value: null },
  { label: 'Serif', value: 'ui-serif, Georgia, "Times New Roman", serif' },
  {
    label: 'Mono',
    value: 'ui-monospace, SFMono-Regular, Menlo, "JetBrains Mono", monospace',
  },
];

const EDGE_MARGIN = 8;
const SELECTION_GAP = 8;

function isToggleActive(state: EditorState, markType: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) {
    return !!markType.isInSet(state.storedMarks ?? $from.marks());
  }
  return state.doc.rangeHasMark(from, to, markType);
}

// Returns the attrs of `markType` applied uniformly across the selection,
// or null if the selection spans unmarked text or mixed attr values.
function uniformMarkAttrs(
  state: EditorState,
  markType: MarkType,
): Record<string, unknown> | null {
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const m = markType.isInSet(state.storedMarks ?? $from.marks());
    return m ? (m.attrs as Record<string, unknown>) : null;
  }
  let result: Record<string, unknown> | null = null;
  let consistent = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) {
      return;
    }
    const m = node.marks.find((mm) => mm.type === markType);
    if (!m) {
      consistent = false;
      return;
    }
    if (result && JSON.stringify(result) !== JSON.stringify(m.attrs)) {
      consistent = false;
      return;
    }
    result = m.attrs as Record<string, unknown>;
  });
  return consistent ? result : null;
}

// Clear + optionally re-apply an attributed mark over the current selection.
function setAttributedMark(
  view: EditorView,
  markType: MarkType,
  attrs: Record<string, unknown> | null,
): void {
  const { from, to } = view.state.selection;
  if (from === to) {
    return;
  }
  let tr = view.state.tr.removeMark(from, to, markType);
  if (attrs) {
    tr = tr.addMark(from, to, markType.create(attrs));
  }
  view.dispatch(tr);
  view.focus();
}

// Screen-pixel rect for the current selection, anchored on the editor's own
// frame DOM so it tracks the page-frame's zoom/scale regardless of where the
// canvas sits in the window.
function selectionScreenRect(
  view: EditorView,
): { centerX: number; top: number; bottom: number } | null {
  const { from, to, empty } = view.state.selection;
  if (empty) {
    return null;
  }
  const start = getPageFramePmScreenRectForPos(view, from);
  const end = getPageFramePmScreenRectForPos(view, to);
  if (!(start && end)) {
    return null;
  }
  return {
    centerX: (start.left + end.right) / 2,
    top: Math.min(start.top, end.top),
    bottom: Math.max(start.bottom, end.bottom),
  };
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

function attrsEqual(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function styleEqual(a: CSSProperties, b: CSSProperties): boolean {
  return a.left === b.left && a.top === b.top;
}

export function FloatingToolbar({ view }: FloatingToolbarProps) {
  const {
    colors: customColors,
    canAddColor,
    promptAddColor,
    removeColor,
    pickerOpen,
  } = useCustomColors('text');
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const [openMenu, setOpenMenu] = useState<'font' | 'color' | null>(null);
  const [swatchMenuOpen, setSwatchMenuOpen] = useState(false);
  // Tracked marks re-computed on every PM update so button states stay in sync.
  const [active, setActive] = useState<Set<string>>(new Set());
  const [fontAttrs, setFontAttrs] = useState<Record<string, unknown> | null>(
    null,
  );
  const [colorAttrs, setColorAttrs] = useState<Record<string, unknown> | null>(
    null,
  );

  const sync = useEffectEvent(() => {
    const rect = selectionScreenRect(view);
    if (!rect) {
      setVisible(false);
      setOpenMenu(null);
      return;
    }
    const nextActive = new Set<string>();
    for (const t of TOGGLE_MARKS) {
      if (isToggleActive(view.state, t.mark)) {
        nextActive.add(t.key);
      }
    }
    setActive((current) =>
      setsEqual(current, nextActive) ? current : nextActive,
    );
    const nextFontAttrs = uniformMarkAttrs(view.state, schema.marks.fontFamily);
    const nextColorAttrs = uniformMarkAttrs(view.state, schema.marks.textColor);
    setFontAttrs((current) =>
      attrsEqual(current, nextFontAttrs) ? current : nextFontAttrs,
    );
    setColorAttrs((current) =>
      attrsEqual(current, nextColorAttrs) ? current : nextColorAttrs,
    );

    const toolbar = ref.current;
    const width = toolbar?.offsetWidth ?? 260;
    const height = toolbar?.offsetHeight ?? 40;

    let left = rect.centerX - width / 2;
    left = Math.max(
      EDGE_MARGIN,
      Math.min(left, window.innerWidth - width - EDGE_MARGIN),
    );

    const above = rect.top - height - SELECTION_GAP;
    const below = rect.bottom + SELECTION_GAP;
    const top =
      above >= EDGE_MARGIN
        ? above
        : Math.min(below, window.innerHeight - height - EDGE_MARGIN);

    const nextStyle = { left, top };
    setStyle((current) =>
      styleEqual(current, nextStyle) ? current : nextStyle,
    );
    setVisible(true);
  });
  const handleDocumentPointerDown = useEffectEvent((event: PointerEvent) => {
    if (pickerOpen || swatchMenuOpen) {
      return;
    }
    const target = event.target as Node | null;
    if (!target) {
      return;
    }
    if (ref.current?.contains(target)) {
      return;
    }
    if (view.dom.contains(target)) {
      return;
    }
    setOpenMenu(null);
    setVisible(false);
  });

  // Re-sync on every PM transaction (covers typing, selection, mark toggles).
  useEffect(() => {
    let raf = 0;
    const schedule = () => {
      if (raf !== 0) {
        return;
      }
      raf = requestAnimationFrame(() => {
        raf = 0;
        sync();
      });
    };
    view.dom.addEventListener(PM_UPDATE_EVENT, schedule);
    schedule();
    return () => {
      view.dom.removeEventListener(PM_UPDATE_EVENT, schedule);
      if (raf !== 0) {
        cancelAnimationFrame(raf);
      }
    };
  }, [view]);

  useLayoutEffect(() => {
    const toolbar = ref.current;
    if (!(visible && toolbar)) {
      return;
    }

    sync();
    const observer = new ResizeObserver(() => {
      sync();
    });

    observer.observe(toolbar);
    return () => {
      observer.disconnect();
    };
  }, [visible]);

  // Native pointerdown listener on the toolbar DOM node. This stops the
  // event from bubbling to the canvas's document-level exit-edit handler,
  // which would otherwise tear down edit mode (and unmount this toolbar)
  // before a button's click event fires. React synthetic stopPropagation
  // isn't reliable here because the toolbar is portaled to document.body
  // and the native event reaches document through the DOM, not React's
  // fiber tree.
  useEffect(() => {
    if (!visible) {
      return;
    }

    const el = ref.current;
    if (!el) {
      return;
    }
    const block = (e: PointerEvent) => {
      e.stopPropagation();
    };
    el.addEventListener('pointerdown', block);
    return () => el.removeEventListener('pointerdown', block);
  }, [visible]);

  // Pointer outside the toolbar + outside the editor: dismiss + clear menu.
  // Suspended while the custom-color picker or a swatch's delete menu is open —
  // both portal outside the toolbar's subtree, so clicks inside them would
  // otherwise trigger dismiss.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      handleDocumentPointerDown(event);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  if (!visible) {
    return null;
  }

  const currentFont = fontAttrs?.family as string | undefined;
  const currentColor = colorAttrs?.color as string | undefined;

  const onToggle = (markType: MarkType) => {
    const cmd = toggleMark(markType);
    cmd(view.state, view.dispatch);
    view.focus();
  };

  const onPickFont = (value: string | null) => {
    setAttributedMark(
      view,
      schema.marks.fontFamily,
      value ? { family: value } : null,
    );
    setOpenMenu(null);
  };

  // Re-selecting the active color clears the mark — matches toggle UX and
  // removes the need for a separate "Default" swatch.
  const onPickColor = (value: string) => {
    setAttributedMark(
      view,
      schema.marks.textColor,
      currentColor === value ? null : { color: value },
    );
    setOpenMenu(null);
  };

  return createPortal(
    <div
      ref={ref}
      className="fade-in-0 zoom-in-95 fixed z-50 flex animate-in items-center gap-1 rounded-xl bg-card/80 p-1 shadow-ambient backdrop-blur-[24px] duration-150"
      style={{
        ...style,
        border: '1px solid var(--border-ghost)',
      }}
      onPointerDown={(e) => {
        // Keep PM selection intact when interacting with the toolbar.
        e.preventDefault();
      }}
    >
      {TOGGLE_MARKS.map(({ key, icon: Icon, mark, label }) => (
        <ToolbarButton
          key={key}
          label={label}
          active={active.has(key)}
          onClick={() => onToggle(mark)}
        >
          <Icon className="size-4" />
        </ToolbarButton>
      ))}

      <Divider />

      <div className="relative">
        <ToolbarButton
          label="Font"
          active={openMenu === 'font' || !!currentFont}
          onClick={() => setOpenMenu(openMenu === 'font' ? null : 'font')}
          wide
        >
          <Type className="size-4" />
          <span className="max-w-[64px] truncate text-xs">
            {fontLabelFor(currentFont)}
          </span>
          <ChevronDown className="size-3 opacity-60" />
        </ToolbarButton>
        {openMenu === 'font' && (
          <Popover>
            {FONTS.map((f) => (
              <button
                key={f.label}
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => onPickFont(f.value)}
                className={`flex w-full cursor-pointer items-center justify-between rounded-md border-none bg-transparent px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-hover-tint ${
                  (f.value ?? null) === (currentFont ?? null)
                    ? 'text-text-primary'
                    : 'text-text-secondary'
                }`}
                style={{ fontFamily: f.value ?? undefined }}
              >
                {f.label}
              </button>
            ))}
          </Popover>
        )}
      </div>

      <div className="relative">
        <ToolbarButton
          label="Color"
          onClick={() => setOpenMenu(openMenu === 'color' ? null : 'color')}
        >
          <div className="flex size-4 flex-col items-center justify-center">
            <span className="font-semibold text-[11px] leading-none">A</span>
            <span
              className="mt-0.5 block h-[3px] w-3 rounded-[1px]"
              style={{ background: currentColor ?? 'currentColor' }}
            />
          </div>
        </ToolbarButton>
        {openMenu === 'color' && (
          <Popover>
            <div className="flex max-w-[280px] flex-wrap items-center gap-1.5 p-1">
              {PEN_COLORS.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  active={currentColor === color}
                  onClick={() => onPickColor(color)}
                  onPointerDown={(e) => e.preventDefault()}
                />
              ))}
              {customColors.map((color) => (
                <CustomColorSwatch
                  key={color}
                  color={color}
                  active={currentColor === color}
                  onClick={() => onPickColor(color)}
                  onDelete={() => {
                    if (currentColor === color) {
                      setAttributedMark(view, schema.marks.textColor, null);
                    }
                    void removeColor(color);
                  }}
                  onPointerDown={(e) => e.preventDefault()}
                  onMenuOpenChange={setSwatchMenuOpen}
                />
              ))}
              {canAddColor && (
                <AddColorSwatch
                  onClick={() => {
                    setOpenMenu(null);
                    promptAddColor();
                  }}
                  onPointerDown={(e) => e.preventDefault()}
                />
              )}
            </div>
          </Popover>
        )}
      </div>
    </div>,
    document.body,
  );
}

function fontLabelFor(family: string | undefined): string {
  if (!family) {
    return 'Sans';
  }
  const match = FONTS.find((f) => f.value === family);
  return match ? match.label : 'Custom';
}

interface ToolbarButtonProps {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  wide?: boolean;
  onClick: () => void;
}

function ToolbarButton({
  children,
  label,
  active,
  wide,
  onClick,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-8 cursor-pointer items-center justify-center gap-1 rounded-lg border-none px-2 transition-colors duration-100 ${
        wide ? '' : 'w-8'
      } ${
        active
          ? 'bg-accent-dark text-text-on-dark'
          : 'bg-transparent text-text-secondary hover:bg-hover-tint hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-0.5 h-5 w-px bg-border-ghost" />;
}

function Popover({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fade-in-0 zoom-in-95 absolute top-full left-1/2 z-[51] mt-1 min-w-[180px] animate-in overflow-hidden rounded-xl bg-popover/95 p-1 shadow-ambient backdrop-blur-2xl duration-100"
      style={{
        transform: 'translateX(-50%)',
        border: '0.5px solid var(--border-ghost)',
      }}
    >
      {children}
    </div>
  );
}
