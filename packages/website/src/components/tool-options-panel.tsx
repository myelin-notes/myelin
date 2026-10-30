import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ChevronDown as ChevronDownIcon, Flag as FlagIcon } from 'lucide-react';
import { AddColorSwatch } from '@myelin/editor/components/add-color-swatch';
import { ColorSwatch } from '@myelin/editor/components/color-swatch';
import { CustomColorSwatch } from '@myelin/editor/components/custom-color-swatch';
import { FontSizeField } from '@myelin/editor/components/font-size-field';
import { resolveFlagType } from '@myelin/editor/elements/flag-element';
import { defaultFlagTypes } from '@myelin/editor/flag-types';
import { ensureDisplayFont } from '@myelin/editor/google-fonts';
import type { CustomColorTool } from '@myelin/editor/sync/repo/types';
import type { FontEntry, ToolOption } from '@myelin/editor/tools/tool';
import { Switch } from '@/components/ui/switch';
import { useCustomColors } from '@/lib/custom-colors';
import { useMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface ToolOptionsPanelProps {
  options: ToolOption[];
  customColorTool: CustomColorTool | null;
}

function preloadAllFonts(fonts: FontEntry[]) {
  for (const f of fonts) {
    ensureDisplayFont(f.family);
  }
}

/* ── Font picker dropdown ───────────────────────────────── */

function FontPicker({
  value,
  fonts,
  onChange,
}: {
  value: string;
  fonts: FontEntry[];
  onChange: (family: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleWindowPointerDown = useEffectEvent((event: PointerEvent) => {
    if (!containerRef.current?.contains(event.target as Node)) {
      setOpen(false);
    }
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      handleWindowPointerDown(event);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            preloadAllFonts(fonts);
          }
        }}
        className="flex pointer-coarse:min-h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border-none bg-surface px-2.5 py-1.5 font-medium text-text-primary text-xs transition-colors hover:bg-card-active"
        style={{ fontFamily: `"${value}", sans-serif` }}
      >
        <span className="flex-1 truncate text-left">{value}</span>
        <ChevronDownIcon
          className={`size-3 shrink-0 text-text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1.5 max-h-60 w-52 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl bg-card py-1 shadow-ambient">
          {fonts.map((font) => (
            <button
              key={font.family}
              onClick={() => {
                onChange(font.family);
                setOpen(false);
              }}
              className={`w-full cursor-pointer border-none px-3 py-2 text-left text-xs transition-colors ${
                value === font.family
                  ? 'bg-accent-dark text-text-on-dark'
                  : 'bg-transparent text-text-primary hover:bg-hover-tint'
              }`}
              style={{ fontFamily: `"${font.family}", ${font.category}` }}
            >
              {font.family}
              <span
                className={`ml-2 text-[10px] ${
                  value === font.family
                    ? 'text-text-on-dark/50'
                    : 'text-text-muted'
                }`}
              >
                {font.category}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main panel ─────────────────────────────────────────── */

export function ToolOptionsPanel({
  options,
  customColorTool,
}: ToolOptionsPanelProps) {
  const strings = useMessages();
  const {
    colors: customColors,
    canAddColor,
    promptAddColor,
    removeColor,
  } = useCustomColors(customColorTool ?? 'pen');

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="flex max-h-[min(44rem,calc(100dvh-6rem))] w-full flex-col gap-3 overflow-y-auto overscroll-contain rounded-xl bg-popover/85 px-3.5 py-3 shadow-ambient backdrop-blur-md">
      {options.map((option) => {
        if (option.type === 'color') {
          return (
            <div key={option.key} className="flex flex-col gap-1.5">
              <span className="select-none font-medium text-text-muted text-xs">
                {option.label}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {option.palette.map((color) => (
                  <ColorSwatch
                    key={color}
                    color={color}
                    active={option.value === color}
                    onClick={() => option.set(color)}
                    size="md"
                  />
                ))}
                {customColorTool &&
                  customColors.map((color) => (
                    <CustomColorSwatch
                      key={color}
                      color={color}
                      active={option.value === color}
                      onClick={() => option.set(color)}
                      size="md"
                      onDelete={() => {
                        if (
                          option.value === color &&
                          option.palette.length > 0
                        ) {
                          option.set(option.palette[0]);
                        }
                        void removeColor(color);
                      }}
                    />
                  ))}
                {customColorTool && canAddColor && (
                  <AddColorSwatch onClick={promptAddColor} size="md" />
                )}
              </div>
            </div>
          );
        }

        if (option.type === 'size') {
          return (
            <div key={option.key} className="flex flex-col gap-1.5">
              <span className="select-none font-medium text-text-muted text-xs">
                {option.label}
              </span>
              <div className="flex min-w-0 items-center gap-2">
                <input
                  type="range"
                  min={option.min}
                  max={option.max}
                  step={option.step}
                  value={option.value}
                  onChange={(e) => option.set(Number(e.target.value))}
                  aria-label={option.label}
                  className="tool-slider min-w-0 flex-1"
                />
                <FontSizeField
                  value={option.value}
                  min={option.min}
                  max={option.max}
                  step={option.step}
                  onChange={option.set}
                  ariaLabel={option.label}
                  touchTargets
                />
              </div>
            </div>
          );
        }

        if (option.type === 'choice') {
          return (
            <div key={option.key} className="flex flex-col gap-1.5">
              <span className="select-none font-medium text-text-muted text-xs">
                {option.label}
              </span>
              <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-surface p-0.5">
                {option.choices.map((choice) => {
                  const active = option.value === choice.value;
                  const Icon = choice.icon;
                  return (
                    <button
                      key={choice.value}
                      onClick={() => option.set(choice.value)}
                      className={`flex pointer-coarse:min-h-9 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border-none px-2 py-1 font-medium text-xs transition-all duration-150 ${
                        active
                          ? 'bg-card text-text-primary shadow-sm'
                          : 'bg-transparent text-text-muted hover:text-text-secondary'
                      }`}
                    >
                      {Icon && <Icon className="size-3.5 shrink-0" />}
                      {choice.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }

        if (option.type === 'font') {
          return (
            <div key={option.key} className="flex flex-col gap-1.5">
              <span className="select-none font-medium text-text-muted text-xs">
                {option.label}
              </span>
              <div className="w-full">
                <FontPicker
                  value={option.value}
                  fonts={option.fonts}
                  onChange={(family) => {
                    ensureDisplayFont(family);
                    option.set(family);
                  }}
                />
              </div>
            </div>
          );
        }

        // The try page has no repository to save edits to, so only the default types are offered.
        if (option.type === 'flag') {
          const types = defaultFlagTypes(strings);
          const active = resolveFlagType(types, option.value);
          return (
            <div key={option.key} className="flex flex-col gap-1.5">
              <span className="select-none font-medium text-text-muted text-xs">
                {option.label}
              </span>
              <div className="flex flex-col gap-0.5">
                {types.map((type) => (
                  <div
                    key={type.id}
                    className={cn(
                      'flex items-center gap-0.5 rounded-md transition-colors',
                      type === active ? 'bg-surface' : 'hover:bg-hover-tint',
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={type === active}
                      onClick={() => option.set(type.id)}
                      className="flex pointer-coarse:min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 border-none bg-transparent px-2 py-1.5 text-left font-medium text-text-primary text-xs"
                    >
                      <FlagIcon
                        className="size-3.5 shrink-0"
                        style={{ color: type.color }}
                      />
                      <span className="truncate">{type.name}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (option.type === 'toggle') {
          return (
            <div key={option.key} className="flex flex-col gap-1.5">
              <span className="select-none font-medium text-text-muted text-xs">
                {option.label}
              </span>
              <Switch
                checked={option.value}
                onCheckedChange={option.set}
                aria-label={option.label}
                className="relative pointer-coarse:my-2 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2"
              />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
