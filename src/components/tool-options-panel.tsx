import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ChevronDown as ChevronDownIcon } from 'lucide-react';
import { AddColorSwatch } from '@myelin/editor/components/add-color-swatch';
import { ColorSwatch } from '@myelin/editor/components/color-swatch';
import { CustomColorSwatch } from '@myelin/editor/components/custom-color-swatch';
import type { FontEntry, ToolOption } from '@myelin/editor/tools/tool';
import { useCustomColors } from '@/lib/custom-colors';

interface ToolOptionsPanelProps {
  options: ToolOption[];
}

/* ── Font loading ───────────────────────────────────────── */

const loadedFonts = new Set<string>();

export function loadGoogleFont(family: string) {
  if (loadedFonts.has(family)) {
    return;
  }
  loadedFonts.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}

function preloadAllFonts(fonts: FontEntry[]) {
  for (const f of fonts) {
    loadGoogleFont(f.family);
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
        className="flex min-w-[120px] cursor-pointer items-center gap-2 rounded-lg border-none bg-surface px-2.5 py-1.5 font-medium text-text-primary text-xs transition-colors hover:bg-card-active"
        style={{ fontFamily: `"${value}", sans-serif` }}
      >
        <span className="flex-1 truncate text-left">{value}</span>
        <ChevronDownIcon
          className={`size-3 shrink-0 text-text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1.5 max-h-60 w-52 overflow-y-auto rounded-xl bg-card py-1 shadow-ambient">
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

export function ToolOptionsPanel({ options }: ToolOptionsPanelProps) {
  const {
    colors: customColors,
    promptAddColor,
    removeColor,
  } = useCustomColors();

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-popover/85 px-3.5 py-3 shadow-ambient backdrop-blur-md">
      {options.map((option) => {
        if (option.type === 'color') {
          return (
            <div key={option.key} className="flex flex-col gap-1.5">
              <span className="select-none font-bold text-[10px] text-text-muted uppercase tracking-[0.1em]">
                {option.label}
              </span>
              <div className="flex max-w-[120px] flex-wrap items-center gap-1.5">
                {option.palette.map((color) => (
                  <ColorSwatch
                    key={color}
                    color={color}
                    active={option.value === color}
                    onClick={() => option.set(color)}
                  />
                ))}
                {customColors.map((color) => (
                  <CustomColorSwatch
                    key={color}
                    color={color}
                    active={option.value === color}
                    onClick={() => option.set(color)}
                    onDelete={() => {
                      if (option.value === color && option.palette.length > 0) {
                        option.set(option.palette[0]);
                      }
                      void removeColor(color);
                    }}
                  />
                ))}
                <AddColorSwatch onClick={promptAddColor} />
              </div>
            </div>
          );
        }

        if (option.type === 'size') {
          return (
            <div key={option.key} className="flex flex-col gap-1.5">
              <span className="select-none font-bold text-[10px] text-text-muted uppercase tracking-[0.1em]">
                {option.label}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={option.min}
                  max={option.max}
                  step={option.step}
                  value={option.value}
                  onChange={(e) => option.set(Number(e.target.value))}
                  className="tool-slider w-20"
                />
                <span className="w-5 select-none text-right font-medium text-[10px] text-text-secondary tabular-nums">
                  {option.value}
                </span>
              </div>
            </div>
          );
        }

        if (option.type === 'choice') {
          return (
            <div key={option.key} className="flex flex-col gap-1.5">
              <span className="select-none font-bold text-[10px] text-text-muted uppercase tracking-[0.1em]">
                {option.label}
              </span>
              <div className="flex items-center gap-0.5 rounded-lg bg-surface p-0.5">
                {option.choices.map((choice) => {
                  const active = option.value === choice.value;
                  const Icon = choice.icon;
                  return (
                    <button
                      key={choice.value}
                      onClick={() => option.set(choice.value)}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-md border-none px-2 py-1 font-medium text-xs transition-all duration-150 ${
                        active
                          ? 'bg-card text-text-primary shadow-sm'
                          : 'bg-transparent text-text-muted hover:text-text-secondary'
                      }`}
                    >
                      {Icon && <Icon className="size-3.5" />}
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
              <span className="select-none font-bold text-[10px] text-text-muted uppercase tracking-[0.1em]">
                {option.label}
              </span>
              <FontPicker
                value={option.value}
                fonts={option.fonts}
                onChange={(family) => {
                  loadGoogleFont(family);
                  option.set(family);
                }}
              />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
