import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ChevronDown as ChevronDownIcon, Type as TypeIcon } from 'lucide-react';
import { AddColorSwatch } from '@myelin/editor/components/add-color-swatch';
import { ColorSwatch } from '@myelin/editor/components/color-swatch';
import { CustomColorSwatch } from '@myelin/editor/components/custom-color-swatch';
import type {
  TextElement,
  TextStyle,
} from '@myelin/editor/elements/text/element';
import { ensureDisplayFont } from '@myelin/editor/google-fonts';
import {
  TEXT_COLORS,
  TEXT_FONT_SIZE_MAX,
  TEXT_FONT_SIZE_MIN,
  TEXT_FONT_SIZE_STEP,
  TEXT_FONTS,
} from '@myelin/editor/tools/text-tool';
import { FontSizeField } from '@/components/font-size-field';
import { useCustomColors } from '@/lib/custom-colors';
import { useMessages } from '@/lib/i18n';

interface TextStyleControlsProps {
  element: TextElement;
  style: TextStyle;
}

/**
 * Font / size / color for the selected text box, applied straight to the
 * element. This is the object-first path: the tool options panel only ever sets
 * the defaults used by the *next* box.
 */
export function TextStyleControls({ element, style }: TextStyleControlsProps) {
  const strings = useMessages();
  const {
    colors: customColors,
    canAddColor,
    promptAddColor,
    removeColor,
    pickerOpen,
  } = useCustomColors('text');
  const containerRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<'font' | 'color' | null>(null);
  const [swatchMenuOpen, setSwatchMenuOpen] = useState(false);

  // The custom color picker and a swatch's delete menu portal outside this
  // subtree, so leave the menu up while either is in use or the swatch grid
  // would vanish under it.
  const handleDocumentPointerDown = useEffectEvent((event: PointerEvent) => {
    if (
      pickerOpen ||
      swatchMenuOpen ||
      containerRef.current?.contains(event.target as Node)
    ) {
      return;
    }
    setOpenMenu(null);
  });

  useEffect(() => {
    if (!openMenu) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      handleDocumentPointerDown(event);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openMenu]);

  const pickFont = (family: string) => {
    ensureDisplayFont(family);
    element.setStyle({ fontFamily: family });
    setOpenMenu(null);
  };

  const pickColor = (color: string) => {
    element.setStyle({ color });
    setOpenMenu(null);
  };

  return (
    <div ref={containerRef} className="flex items-center gap-1">
      <div className="relative">
        <StyleButton
          label={strings.canvas.toolOptions.font}
          active={openMenu === 'font'}
          onClick={() => {
            const next = openMenu === 'font' ? null : 'font';
            if (next) {
              for (const font of TEXT_FONTS) {
                ensureDisplayFont(font.family);
              }
            }
            setOpenMenu(next);
          }}
          wide
        >
          <TypeIcon className="size-3.5" />
          <span className="max-w-[64px] truncate text-xs">
            {style.fontFamily}
          </span>
          <ChevronDownIcon className="size-3 opacity-60" />
        </StyleButton>
        {openMenu === 'font' && (
          <Popover>
            <div className="max-h-60 overflow-y-auto">
              {TEXT_FONTS.map((font) => (
                <button
                  key={font.family}
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pickFont(font.family)}
                  className={`w-full cursor-pointer rounded-md border-none px-2.5 py-1.5 text-left text-xs transition-colors ${
                    style.fontFamily === font.family
                      ? 'bg-accent-dark text-text-on-dark'
                      : 'bg-transparent text-text-primary hover:bg-hover-tint'
                  }`}
                  style={{ fontFamily: `"${font.family}", ${font.category}` }}
                >
                  {font.family}
                </button>
              ))}
            </div>
          </Popover>
        )}
      </div>

      <FontSizeField
        value={style.fontSize}
        min={TEXT_FONT_SIZE_MIN}
        max={TEXT_FONT_SIZE_MAX}
        step={TEXT_FONT_SIZE_STEP}
        onChange={(fontSize) => element.setStyle({ fontSize })}
        preserveFocus
      />

      <div className="relative">
        <StyleButton
          label={strings.canvas.toolOptions.color}
          active={openMenu === 'color'}
          onClick={() => setOpenMenu(openMenu === 'color' ? null : 'color')}
        >
          <div className="flex size-4 flex-col items-center justify-center">
            <span className="font-semibold text-[11px] leading-none">A</span>
            <span
              className="mt-0.5 block h-[3px] w-3 rounded-[1px]"
              style={{ background: style.color }}
            />
          </div>
        </StyleButton>
        {openMenu === 'color' && (
          <Popover>
            <div className="flex max-w-[176px] flex-wrap items-center gap-1.5 p-1">
              {TEXT_COLORS.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  active={style.color === color}
                  onClick={() => pickColor(color)}
                  onPointerDown={(e) => e.preventDefault()}
                />
              ))}
              {customColors.map((color) => (
                <CustomColorSwatch
                  key={color}
                  color={color}
                  active={style.color === color}
                  onClick={() => pickColor(color)}
                  onDelete={() => {
                    if (style.color === color) {
                      element.setStyle({ color: TEXT_COLORS[0] });
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
    </div>
  );
}

interface StyleButtonProps {
  children: React.ReactNode;
  label: string;
  active: boolean;
  wide?: boolean;
  onClick: () => void;
}

function StyleButton({
  children,
  label,
  active,
  wide,
  onClick,
}: StyleButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      // Pressing a control must not pull the caret out of the text box being
      // edited, so the press never moves focus.
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-8 cursor-pointer items-center justify-center gap-1 rounded-lg border-none px-2 transition-colors ${
        wide ? '' : 'w-8'
      } ${
        active
          ? 'bg-accent-dark text-text-on-dark'
          : 'bg-transparent text-inherit hover:bg-hover-tint hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

function Popover({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fade-in-0 zoom-in-95 absolute top-full left-1/2 z-[111] mt-1.5 min-w-[160px] animate-in overflow-hidden rounded-xl bg-popover/95 p-1 shadow-ambient backdrop-blur-2xl duration-100"
      style={{
        transform: 'translateX(-50%)',
        border: '0.5px solid var(--border-ghost)',
      }}
    >
      {children}
    </div>
  );
}
