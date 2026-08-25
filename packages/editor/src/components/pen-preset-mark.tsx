import { ADAPTIVE_INK } from '../canvas-theme';
import type { PenPreset, PenPresetTool } from '../sync/repo/types';

/** Each tool's stroke range, and the mark footprint it maps onto. */
const MARK_GEOMETRY: Record<
  PenPresetTool,
  { min: number; max: number; from: number; to: number }
> = {
  pen: { min: 1, max: 40, from: 4, to: 16 },
  highlighter: { min: 12, max: 60, from: 4, to: 12 },
};

const BAR_WIDTH = 16;

interface PenPresetMarkProps {
  preset: PenPreset;
  /** Set on an accent-filled chip, where the adaptive-ink sentinel must invert to stay visible. */
  onDark?: boolean;
  className?: string;
}

/**
 * A preset's glyph: a round nib for the pen, a chisel bar for the highlighter, filled with the
 * preset's colour and scaled by its stroke. Sized to sit in the same 16px box as a tool icon.
 */
export function PenPresetMark({
  preset,
  onDark,
  className,
}: PenPresetMarkProps) {
  const { min, max, from, to } = MARK_GEOMETRY[preset.tool];
  const t = (Math.min(Math.max(preset.size, min), max) - min) / (max - min);
  const thickness = Math.round(from + t * (to - from));
  const isBar = preset.tool === 'highlighter';
  const adaptive = preset.color.toLowerCase() === ADAPTIVE_INK;

  return (
    <span
      className={`flex shrink-0 items-center justify-center ${className ?? ''}`}
    >
      <span
        className="block"
        style={{
          width: isBar ? BAR_WIDTH : thickness,
          height: thickness,
          borderRadius: isBar ? 2 : '50%',
          // The ink sentinel previews what the theme will paint, as `ColorSwatch` does.
          backgroundColor: adaptive
            ? onDark
              ? 'var(--text-on-dark)'
              : 'var(--text-primary)'
            : preset.color,
          // Without an edge a pale highlighter mark disappears against the popover.
          boxShadow: 'inset 0 0 0 1px var(--border-ghost)',
        }}
      />
    </span>
  );
}

/** The mark as a `WheelItem.icon` — a component taking only the ring's sizing class. */
export function makePenPresetMarkIcon(preset: PenPreset) {
  return function PenPresetMarkIcon({ className }: { className?: string }) {
    return <PenPresetMark preset={preset} className={className} />;
  };
}
