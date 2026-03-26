import { useState, useEffect, useRef } from "react";
import type { ToolOption, FontEntry } from "@/pages/free-canvas/tools/tool";
import { ChevronDown as ChevronDownIcon } from "lucide-react";

interface ToolOptionsPanelProps {
    options: ToolOption[];
    onSetOption: (key: string, value: unknown) => void;
}

/* ── Font loading ───────────────────────────────────────── */

const loadedFonts = new Set<string>();

export function loadGoogleFont(family: string) {
    if (loadedFonts.has(family)) return;
    loadedFonts.add(family);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`;
    document.head.appendChild(link);
}

function preloadAllFonts(fonts: FontEntry[]) {
    for (const f of fonts) loadGoogleFont(f.family);
}

/* ── Font picker dropdown ───────────────────────────────── */

function FontPicker({ value, fonts, onChange }: {
    value: string;
    fonts: FontEntry[];
    onChange: (family: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function handlePointerDown(e: PointerEvent) {
            if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
        }
        window.addEventListener("pointerdown", handlePointerDown);
        return () => window.removeEventListener("pointerdown", handlePointerDown);
    }, [open]);

    return (
        <div ref={containerRef} className="relative">
            <button
                onClick={() => {
                    const next = !open;
                    setOpen(next);
                    if (next) preloadAllFonts(fonts);
                }}
                className="bg-surface rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-primary border-none cursor-pointer flex items-center gap-2 hover:bg-hover-tint transition-colors min-w-[120px]"
                style={{ fontFamily: `"${value}", sans-serif` }}
            >
                <span className="flex-1 text-left truncate">{value}</span>
                <ChevronDownIcon className={`size-3 text-text-muted shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="absolute top-full mt-1.5 left-0 bg-card rounded-xl shadow-ambient py-1 w-52 max-h-60 overflow-y-auto z-50">
                    {fonts.map((font) => (
                        <button
                            key={font.family}
                            onClick={() => {
                                onChange(font.family);
                                setOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-xs border-none cursor-pointer transition-colors ${
                                value === font.family
                                    ? "bg-accent-dark text-white"
                                    : "bg-transparent hover:bg-hover-tint text-text-primary"
                            }`}
                            style={{ fontFamily: `"${font.family}", ${font.category}` }}
                        >
                            {font.family}
                            <span className={`ml-2 text-[10px] ${
                                value === font.family ? "text-white/50" : "text-text-muted"
                            }`}>
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

export function ToolOptionsPanel({ options, onSetOption }: ToolOptionsPanelProps) {
    if (options.length === 0) return null;

    return (
        <div className="backdrop-blur-[24px] bg-white/85 rounded-xl shadow-ambient px-4 py-2.5 animate-in fade-in slide-in-from-top-2 duration-200 flex items-center gap-5">
            {options.map((option) => {
                if (option.type === "color") {
                    return (
                        <div key={option.key} className="flex items-center gap-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted select-none">
                                {option.label}
                            </span>
                            <div className="flex items-center gap-1.5">
                                {option.palette.map((color) => {
                                    const active = option.value === color;
                                    return (
                                        <button
                                            key={color}
                                            onClick={() => onSetOption(option.key, color)}
                                            className="size-5 rounded-lg cursor-pointer border-none p-0 transition-transform duration-150"
                                            style={{
                                                backgroundColor: color,
                                                boxShadow: active
                                                    ? "0 0 0 2px rgba(255,255,255,0.9), 0 0 0 3.5px rgba(25,28,30,0.25)"
                                                    : "inset 0 0 0 1px rgba(25,28,30,0.06)",
                                                transform: active ? "scale(1.15)" : undefined,
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    );
                }

                if (option.type === "size") {
                    return (
                        <div key={option.key} className="flex items-center gap-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted select-none">
                                {option.label}
                            </span>
                            <input
                                type="range"
                                min={option.min}
                                max={option.max}
                                step={option.step}
                                value={option.value}
                                onChange={(e) => onSetOption(option.key, Number(e.target.value))}
                                className="tool-slider w-24"
                            />
                            <span className="text-[10px] font-medium text-text-secondary w-5 text-right tabular-nums select-none">
                                {option.value}
                            </span>
                        </div>
                    );
                }

                if (option.type === "choice") {
                    return (
                        <div key={option.key} className="flex items-center gap-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted select-none">
                                {option.label}
                            </span>
                            <div className="flex items-center bg-surface rounded-lg p-0.5 gap-0.5">
                                {option.choices.map((choice) => {
                                    const active = option.value === choice.value;
                                    const Icon = choice.icon;
                                    return (
                                        <button
                                            key={choice.value}
                                            onClick={() => onSetOption(option.key, choice.value)}
                                            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border-none cursor-pointer transition-all duration-150 ${
                                                active
                                                    ? "bg-white text-text-primary shadow-sm"
                                                    : "bg-transparent text-text-muted hover:text-text-secondary"
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

                if (option.type === "font") {
                    return (
                        <div key={option.key} className="flex items-center gap-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted select-none">
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
