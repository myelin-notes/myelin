import { useEffect, useEffectEvent } from 'react';
import { Plus as PlusIcon } from 'lucide-react';
import { PenPresetMark } from '@myelin/editor/components/pen-preset-mark';
import { useMessages } from '@myelin/editor/i18n';
import { getPenPresetLabel } from '@myelin/editor/pen-presets';
import type { PenPreset, PenPresetTool } from '@myelin/editor/sync/repo/types';
import type { ITool } from '@myelin/editor/tools/tool';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { PenPresetMenu } from '@/components/pen-preset-menu';

/**
 * Ring-0 slices, tools and presets together. 45° apart is the sweet spot for eyes-free selection,
 * and at the phone radius a ninth 32px button would overlap its neighbours.
 */
export const MAX_WHEEL_ENTRIES = 8;

interface ToolShelfProps {
  tools: ITool[];
  enabledIndices: Set<number>;
  presets: PenPreset[];
  activePenTool: PenPresetTool | null;
  wheelFull: boolean;
  /** Null when the live tool can be saved; otherwise why it can't. */
  savePresetDisabledReason: string | null;
  onToggle: (index: number) => void;
  onSavePreset: () => void;
  onUpdatePresetToCurrent: (preset: PenPreset) => void;
  onTogglePresetInWheel: (preset: PenPreset) => void;
  onDeletePreset: (preset: PenPreset) => void;
  onClose: () => void;
  containerRef?: React.RefObject<HTMLElement | null>;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-3 pt-2 pb-1 font-bold text-[10px] text-text-muted uppercase tracking-[0.1em]">
      {children}
    </span>
  );
}

function ShelfRow({
  glyph,
  label,
  enabled,
  onClick,
}: {
  glyph: React.ReactNode;
  label: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center justify-between rounded-lg border-none px-3 py-2 transition-colors ${
        enabled
          ? 'bg-secondary-container/30 hover:bg-secondary-container/50'
          : 'bg-transparent hover:bg-hover-tint'
      }`}
    >
      <div className="flex items-center gap-3">
        {glyph}
        <span className="font-medium text-text-primary text-xs">{label}</span>
      </div>
      <div
        className={`relative flex h-3.5 w-7 items-center rounded-full px-0.5 transition-colors ${
          enabled ? 'bg-accent-dark' : 'bg-text-muted/20'
        }`}
      >
        <div
          className={`h-2.5 w-2.5 rounded-full bg-text-on-dark transition-transform ${
            enabled ? 'translate-x-3' : 'translate-x-0'
          }`}
        />
      </div>
    </button>
  );
}

export function ToolShelf({
  tools,
  enabledIndices,
  presets,
  activePenTool,
  wheelFull,
  savePresetDisabledReason,
  onToggle,
  onSavePreset,
  onUpdatePresetToCurrent,
  onTogglePresetInWheel,
  onDeletePreset,
  onClose,
  containerRef,
}: ToolShelfProps) {
  const strings = useMessages();
  const handleWindowPointerDown = useEffectEvent((event: PointerEvent) => {
    const target = event.target as Node;
    if (containerRef?.current?.contains(target)) {
      return;
    }
    onClose();
  });

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      handleWindowPointerDown(event);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const wheelEmpty =
    enabledIndices.size === 0 && presets.every((preset) => !preset.inWheel);

  return (
    <div className="fade-in slide-in-from-left-2 w-56 animate-in overflow-hidden rounded-xl bg-popover/85 shadow-ambient backdrop-blur-md duration-200">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="font-bold text-[10px] text-text-primary uppercase tracking-[0.1em]">
          {strings.canvas.toolShelf.title}
        </span>
        <button
          onClick={onClose}
          aria-label={strings.common.close}
          className="cursor-pointer border-none bg-transparent p-0 text-text-muted transition-colors hover:text-text-primary"
        >
          <svg
            className="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        <SectionHeading>{strings.canvas.toolShelf.tools}</SectionHeading>
        {tools.map((tool, index) => {
          const Icon = tool.icon;
          const enabled = enabledIndices.has(index);
          return (
            <ShelfRow
              key={index}
              glyph={
                <Icon
                  className={`size-4 ${enabled ? 'text-text-primary' : 'text-text-muted'}`}
                />
              }
              label={tool.label}
              enabled={enabled}
              onClick={() => onToggle(index)}
            />
          );
        })}

        {presets.length > 0 && (
          <SectionHeading>{strings.canvas.toolShelf.presets}</SectionHeading>
        )}
        {presets.map((preset) => (
          <PenPresetMenu
            key={preset.id}
            preset={preset}
            canUpdateToCurrent={activePenTool === preset.tool}
            onUpdateToCurrent={() => onUpdatePresetToCurrent(preset)}
            onToggleInWheel={() => onTogglePresetInWheel(preset)}
            onDelete={() => onDeletePreset(preset)}
          >
            <ShelfRow
              glyph={<PenPresetMark preset={preset} className="size-4" />}
              label={getPenPresetLabel(preset, strings)}
              enabled={preset.inWheel}
              onClick={() => onTogglePresetInWheel(preset)}
            />
          </PenPresetMenu>
        ))}

        <button
          onClick={onSavePreset}
          disabled={savePresetDisabledReason !== null}
          className="mt-1 flex w-full cursor-pointer items-center gap-3 rounded-lg border-none bg-transparent px-3 py-2 text-left transition-colors hover:bg-hover-tint disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <PlusIcon className="size-4 text-text-muted" />
          <span className="font-medium text-text-primary text-xs">
            {strings.canvas.toolPresets.save}
          </span>
        </button>
        {savePresetDisabledReason && (
          <p className="px-3 text-[11px] text-text-muted">
            {savePresetDisabledReason}
          </p>
        )}
      </div>
      {(wheelFull || wheelEmpty) && (
        <p className="px-4 pb-3 text-[11px] text-text-muted">
          {wheelFull
            ? strings.canvas.toolPresets.wheelFull(MAX_WHEEL_ENTRIES)
            : strings.canvas.toolShelf.empty}
        </p>
      )}
    </div>
  );
}

export function loadWheelToolIndices(toolCount: number): Set<number> {
  const stored = UserPrefs.get('wheelTools');
  if (stored.length > 0) {
    const valid = stored.filter((i) => i >= 0 && i < toolCount);
    if (valid.length > 0) {
      return new Set(valid);
    }
  }
  // Default: all tools enabled
  return new Set(Array.from({ length: toolCount }, (_, i) => i));
}

export function saveWheelToolIndices(indices: Set<number>) {
  UserPrefs.set('wheelTools', [...indices]);
}
