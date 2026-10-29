import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Flag, Pencil, Trash2, X } from 'lucide-react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import {
  type FlagElement,
  resolveFlagType,
} from '@myelin/editor/elements/flag-element';
import { useFlagTypes } from '@myelin/editor/flag-types';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import { formatNumber } from '@myelin/editor/i18n/format';
import type { FlagType } from '@myelin/editor/sync/repo/types';
import { cn } from '@myelin/editor/utils';
import { usePresence } from '@myelin/ui';

interface FlagsChipProps {
  canvas: DrawableCanvas | null;
}

export function FlagsChip({ canvas }: FlagsChipProps) {
  const strings = useMessages();
  const locale = useLocale();
  const { types } = useFlagTypes();
  const [flags, setFlags] = useState<FlagElement[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const presence = usePresence(open);

  useEffect(() => {
    if (!canvas) {
      setFlags([]);
      return;
    }
    setFlags(canvas.flags);
    return canvas.onChange(() => setFlags(canvas.flags));
  }, [canvas]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && containerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!canvas || flags.length === 0) {
    return null;
  }

  const labels = strings.canvas.flags;
  const countLabel = formatNumber(flags.length, locale);
  const navButtonClass =
    'flex size-6 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover-tint hover:text-text-primary';
  const groups = types
    .map((type) => ({
      type,
      flags: flags.filter(
        (flag) => resolveFlagType(types, flag.flagTypeId) === type,
      ),
    }))
    .filter((group) => group.flags.length > 0);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={labels.title}
        className={cn(
          'flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-surface px-2 text-text-secondary text-xs transition-colors',
          'hover:bg-surface hover:text-text-primary',
          open && 'bg-surface text-text-primary',
        )}
      >
        <Flag className="size-3.5" />
        <span className="font-medium tabular-nums">{countLabel}</span>
      </button>

      {presence.mounted && (
        <div
          {...presence.state}
          onAnimationEnd={presence.onAnimationEnd}
          role="dialog"
          aria-label={labels.title}
          className="data-closed:slide-out-to-top-1 data-closed:fade-out-0 data-open:slide-in-from-top-1 data-open:fade-in-0 absolute top-full right-0 z-[110] mt-2 flex max-h-[60vh] w-[20rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl bg-popover/95 shadow-ambient backdrop-blur-[24px] duration-[140ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] data-closed:animate-out data-open:animate-in"
        >
          <div className="flex items-center gap-1 px-3 pt-3 pb-2">
            <h2 className="m-0 flex-1 font-semibold text-[13px] text-text-primary">
              {labels.title}
            </h2>
            <button
              type="button"
              onClick={() => canvas.stepFlag(-1)}
              aria-label={labels.previous}
              title={labels.previous}
              className={navButtonClass}
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => canvas.stepFlag(1)}
              aria-label={labels.next}
              title={labels.next}
              className={navButtonClass}
            >
              <ChevronDown className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={strings.common.close}
              className={navButtonClass}
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3">
            {groups.map((group) => (
              <section key={group.type.id}>
                <h3 className="m-0 flex items-center gap-2 px-2 py-1 font-semibold text-text-primary text-xs">
                  <Flag
                    className="size-3.5 shrink-0"
                    style={{ color: group.type.color, fill: group.type.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {group.type.name}
                  </span>
                  <span className="rounded-md bg-surface px-1.5 py-0.5 font-medium text-[11px] text-text-secondary tabular-nums">
                    {formatNumber(group.flags.length, locale)}
                  </span>
                </h3>
                <div className="space-y-0.5">
                  {group.flags.map((flag) => (
                    <FlagRow
                      key={flag.uuid}
                      canvas={canvas}
                      flag={flag}
                      types={types}
                      onTypeChanged={() => setFlags(canvas.flags)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FlagRow({
  canvas,
  flag,
  types,
  onTypeChanged,
}: {
  canvas: DrawableCanvas;
  flag: FlagElement;
  types: FlagType[];
  onTypeChanged: () => void;
}) {
  const labels = useMessages().canvas.flags;
  const [draft, setDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  if (draft !== null) {
    const commit = () => {
      if (draft.trim() !== flag.label) {
        flag.setLabel(draft.trim());
      }
      setDraft(null);
    };
    return (
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft(null);
          }
        }}
        placeholder={labels.untitled}
        className="w-full rounded-md bg-surface py-1.5 pr-2 pl-7.5 text-text-primary text-xs outline-none"
      />
    );
  }

  // No hover tint: it would stack on the row's own hover tint.
  const rowButtonClass =
    'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:text-text-primary';
  const type = resolveFlagType(types, flag.flagTypeId);

  // pl-7.5 lines the name up with the group header's name, past its flag icon.
  return (
    <div className="group rounded-md transition-colors hover:bg-hover-tint">
      <div className="flex items-center pr-1">
        <button
          type="button"
          onClick={() => canvas.focusFlag(flag.uuid)}
          className="min-w-0 flex-1 cursor-pointer truncate py-1.5 pr-2 pl-7.5 text-left text-text-secondary text-xs transition-colors hover:text-text-primary"
        >
          {flag.label || labels.untitled}
        </button>
        <div
          className={cn(
            'flex items-center gap-0.5 transition-opacity',
            !picking &&
              'pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100',
          )}
        >
          <button
            type="button"
            onClick={() => setPicking((value) => !value)}
            aria-label={labels.changeType}
            aria-expanded={picking}
            title={labels.changeType}
            className={rowButtonClass}
          >
            <Flag className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => setDraft(flag.label)}
            aria-label={labels.rename}
            title={labels.rename}
            className={rowButtonClass}
          >
            <Pencil className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => canvas.removeElement(flag)}
            aria-label={labels.remove}
            title={labels.remove}
            className={rowButtonClass}
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
      {picking && (
        <div className="flex flex-wrap gap-1 pr-1.5 pb-1.5 pl-6">
          {types.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option === type}
              onClick={() => {
                setPicking(false);
                if (option !== type) {
                  flag.setFlagTypeId(option.id);
                  onTypeChanged();
                }
              }}
              className={cn(
                'flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-text-secondary transition-colors hover:bg-card-active hover:text-text-primary',
                option === type && 'bg-surface text-text-primary',
              )}
            >
              <Flag
                className="size-3 shrink-0"
                style={{ color: option.color }}
              />
              <span className="truncate">{option.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
