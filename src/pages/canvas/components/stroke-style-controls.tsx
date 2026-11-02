import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { resolveInkColor } from '@myelin/editor/canvas-theme';
import { useCustomColors } from '@myelin/editor/custom-colors';
import type {
  InkStyle,
  InkStyleUpdate,
} from '@myelin/editor/elements/ink-style';
import { useMessages } from '@myelin/editor/i18n';
import { HIGHLIGHT_COLORS } from '@myelin/editor/tools/highlighter-tool';
import { PEN_COLORS } from '@myelin/editor/tools/pen-tool';
import type { ToolOption } from '@myelin/editor/tools/tool';
import { ToolOptionsPanel } from '@/components/tool-options-panel';
import { StyleButton } from './text-style-controls';

// Spans the pen's and the highlighter's ranges, so one selection of both isn't clamped.
const THICKNESS_MIN = 1;
const THICKNESS_MAX = 60;

interface StrokeStyleControlsProps {
  style: InkStyle;
  onChange: (updates: InkStyleUpdate) => void;
}

// The same panel the pen shows, so nothing new to learn. Applied straight to the selection; the
// tool's own options only set the defaults for the next stroke.
export function StrokeStyleControls({
  style,
  onChange,
}: StrokeStyleControlsProps) {
  const strings = useMessages();
  const customColorTool = style.highlighter ? 'highlighter' : 'pen';
  const { pickerOpen } = useCustomColors(customColorTool);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [swatchMenuOpen, setSwatchMenuOpen] = useState(false);

  // The custom color picker and a swatch's delete menu portal outside this subtree.
  const handleDocumentPointerDown = useEffectEvent((event: PointerEvent) => {
    if (
      pickerOpen ||
      swatchMenuOpen ||
      containerRef.current?.contains(event.target as Node)
    ) {
      return;
    }
    setOpen(false);
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      handleDocumentPointerDown(event);
    };
    // Canvas shortcuts ignore a focused input, so Cmd+Z right after a slider drag would do nothing.
    const onPointerUp = () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement && focused.type === 'range') {
        focused.blur();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
    };
  }, [open]);

  const options: ToolOption[] = [
    {
      type: 'color',
      key: 'color',
      label: strings.canvas.toolOptions.color,
      value: style.color,
      palette: style.highlighter ? HIGHLIGHT_COLORS : PEN_COLORS,
      set: (color) => onChange({ color }),
    },
    {
      type: 'size',
      key: 'thickness',
      label: strings.canvas.toolOptions.stroke,
      value: style.thickness,
      min: THICKNESS_MIN,
      max: THICKNESS_MAX,
      step: 1,
      set: (thickness) => onChange({ thickness }),
    },
  ];

  return (
    <div ref={containerRef}>
      <StyleButton
        label={strings.canvas.toolOptions.stroke}
        active={open}
        onClick={() => setOpen(!open)}
      >
        <span
          className="block size-4 rounded-full"
          style={{
            background: resolveInkColor(style.color),
            boxShadow: 'inset 0 0 0 1px var(--border-ghost)',
          }}
        />
      </StyleButton>
      {open && (
        // Positioned against the toolbar, which stays on screen, not this button.
        <div className="absolute in-data-[menu-side=above]:top-auto top-full in-data-[menu-side=above]:bottom-full left-0 z-[111] in-data-[menu-side=above]:mt-0 mt-1.5 in-data-[menu-side=above]:mb-1.5 w-60 rounded-xl bg-popover">
          <ToolOptionsPanel
            options={options}
            customColorTool={customColorTool}
            onSwatchMenuOpenChange={setSwatchMenuOpen}
          />
        </div>
      )}
    </div>
  );
}
