import { useEffect, useRef, useState } from 'react';
import { ChevronDown as ChevronDownIcon } from 'lucide-react';
import type { FontEntry, ToolOption } from '@/pages/canvas/tools/tool';

interface ToolOptionsPanelProps {
  options: ToolOption[];
  onSetOption: (key: string, value: unknown) => void;
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

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
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
        className="flex min-w-[120px] cursor-pointer items-center gap-2 rounded-lg border-none bg-surface px-2.5 py-1.5 font-medium text-text-primary text-xs transition-colors hover:bg-hover-tint"
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
                  ? 'bg-accent-dark text-white'
                  : 'bg-transparent text-text-primary hover:bg-hover-tint'
              }`}
              style={{ fontFamily: `"${font.family}", ${font.category}` }}
            >
              {font.family}
              <span
                className={`ml-2 text-[10px] ${
                  value === font.family ? 'text-white/50' : 'text-text-muted'
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
  onSetOption,
}: ToolOptionsPanelProps) {
  if (options.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-white/85 px-3.5 py-3 shadow-ambient backdrop-blur-[24px]">
      {options.map((option) => {
        if (option.type === 'color') {
          return (
            <div key={option.key} className="flex flex-col gap-1.5">
              <span className="select-none font-bold text-[10px] text-text-muted uppercase tracking-[0.1em]">
                {option.label}
              </span>
              <div className="flex max-w-[120px] flex-wrap items-center gap-1.5">
                {option.palette.map((color) => {
                  const active = option.value === color;
                  return (
                    <button
                      key={color}
                      onClick={() => onSetOption(option.key, color)}
                      className="size-5 cursor-pointer rounded-lg border-none p-0 transition-transform duration-150"
                      style={{
                        backgroundColor: color,
                        boxShadow: active
                          ? '0 0 0 2px rgba(255,255,255,0.9), 0 0 0 3.5px rgba(25,28,30,0.25)'
                          : 'inset 0 0 0 1px rgba(25,28,30,0.06)',
                        transform: active ? 'scale(1.15)' : undefined,
                      }}
                    />
                  );
                })}
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
                  onChange={(e) =>
                    onSetOption(option.key, Number(e.target.value))
                  }
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
                      onClick={() => onSetOption(option.key, choice.value)}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-md border-none px-2 py-1 font-medium text-xs transition-all duration-150 ${
                        active
                          ? 'bg-white text-text-primary shadow-sm'
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
                  onSetOption(option.key, family);
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
