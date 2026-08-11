import {
  type AnimationEventHandler,
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import { HexColorPicker } from 'react-colorful';
import { createPortal } from 'react-dom';
import { type Presence, usePresence } from '@myelin/ui';

const HEX_PATTERN = /^#?([0-9a-fA-F]{6})$/;

export interface ColorPickerDialogProps {
  open: boolean;
  initialColor: string;
  title: string;
  confirmLabel: string;
  onConfirm: (hex: string) => void;
  onCancel: () => void;
}

/**
 * Centered hex color picker, portaled to the body. Confirm-on-Enter,
 * cancel on Escape or an outside pointerdown.
 */
export const ColorPickerDialog = memo(function ColorPickerDialog({
  open,
  initialColor,
  title,
  confirmLabel,
  onConfirm,
  onCancel,
}: ColorPickerDialogProps) {
  const presence = usePresence(open);
  if (!presence.mounted) {
    return null;
  }
  return createPortal(
    <ColorPickerPanel
      presenceState={presence.state}
      onAnimationEnd={presence.onAnimationEnd}
      initialColor={initialColor}
      title={title}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
    document.body,
  );
});

interface ColorPickerPanelProps {
  initialColor: string;
  title: string;
  confirmLabel: string;
  onConfirm: (hex: string) => void;
  onCancel: () => void;
  presenceState: Presence['state'];
  onAnimationEnd: AnimationEventHandler;
}

function ColorPickerPanel({
  initialColor,
  title,
  confirmLabel,
  onConfirm,
  onCancel,
  presenceState,
  onAnimationEnd,
}: ColorPickerPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState<string>(initialColor);
  const [hexInput, setHexInput] = useState<string>(initialColor);
  const handleDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onCancel();
    } else if (event.key === 'Enter') {
      onConfirm(hex);
    }
  });
  const handleDocumentPointerDown = useEffectEvent((event: PointerEvent) => {
    if (!ref.current?.contains(event.target as Node)) {
      onCancel();
    }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleDocumentKeyDown(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Click outside the panel dismisses. Capture phase so we beat other
  // document-level pointerdown listeners (e.g. the floating toolbar's).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      handleDocumentPointerDown(event);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const onPickerChange = useCallback((next: string) => {
    setHex(next);
    setHexInput(next);
  }, []);

  const onHexInputChange = useCallback((raw: string) => {
    setHexInput(raw);
    const match = HEX_PATTERN.exec(raw.trim());
    if (match) {
      setHex(`#${match[1].toLowerCase()}`);
    }
  }, []);

  // `fill-mode-forwards` holds the exit keyframe's end state until React
  // unmounts us. animate-out defaults to `fill-mode: none`, which snaps the
  // panel back to full opacity for a frame once the fade ends — a visible flash.
  return (
    <div
      {...presenceState}
      onAnimationEnd={onAnimationEnd}
      ref={ref}
      className="data-closed:slide-out-to-top-1 data-closed:zoom-out-95 data-closed:fade-out-0 data-open:slide-in-from-top-1 data-open:zoom-in-95 data-open:fade-in-0 pointer-events-auto fixed top-1/2 left-1/2 z-[200] w-[240px] origin-center -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover/90 fill-mode-forwards p-3 shadow-ambient backdrop-blur-2xl duration-[140ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] data-closed:animate-out data-open:animate-in"
      style={{ border: '0.5px solid var(--border-ghost)' }}
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center justify-between pb-2">
        <span className="select-none font-bold text-[10px] text-text-muted uppercase tracking-[0.1em]">
          {title}
        </span>
        <div
          className="size-4 rounded-md transition-colors duration-150"
          style={{
            backgroundColor: hex,
            boxShadow:
              'inset 0 0 0 1px var(--border-ghost), 0 0 0 2px var(--bg-card)',
          }}
        />
      </div>

      <HexColorPicker
        color={hex}
        onChange={onPickerChange}
        className="myelin-color-picker"
      />

      <div className="mt-3 flex items-center gap-2">
        <span className="select-none font-medium text-[10px] text-text-muted uppercase tracking-[0.08em]">
          Hex
        </span>
        <input
          type="text"
          value={hexInput}
          onChange={(e) => onHexInputChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          className="h-6 flex-1 rounded-md border-none bg-surface px-2 font-medium text-[12px] text-text-primary outline-none transition-colors focus:bg-card"
          style={{
            boxShadow: 'inset 0 0 0 0.5px var(--border-ghost)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="h-7 cursor-pointer rounded-lg border-none bg-transparent px-2.5 font-medium text-[12px] text-text-secondary transition-colors hover:bg-hover-tint hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(hex)}
          className="h-7 cursor-pointer rounded-lg border-none bg-gradient-to-b from-accent-dark to-accent-navy px-3 font-medium text-[12px] text-text-on-dark shadow-sm transition-transform duration-100 hover:scale-[1.02] active:scale-[0.98]"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
