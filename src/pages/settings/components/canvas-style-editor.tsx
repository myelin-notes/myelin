import { useRef, useState } from 'react';
import { Check, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  type CanvasColorMode,
  type CanvasPattern,
  type CanvasStyle,
  createBackgroundImage,
} from '@myelin/editor/canvas-style';
import { ColorPickerDialog } from '@myelin/editor/components/color-picker-dialog';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';
import { OptionsRow, OptionsSegmented } from './options-row';

const logger = new Logger('CanvasStyleEditor');

const PATTERNS: readonly CanvasPattern[] = [
  'grid',
  'dots',
  'lines',
  'blank',
  'image',
];

type ColorField = 'backgroundColor' | 'patternColor';

function patternPreviewStyle(
  pattern: CanvasPattern,
  style: CanvasStyle,
): React.CSSProperties {
  const color =
    style.patternColorMode === 'custom'
      ? style.patternColor
      : 'color-mix(in srgb, var(--text-primary) 25%, transparent)';
  const line = `${color} 1px, transparent 1px`;
  const fill =
    style.backgroundColorMode === 'custom'
      ? { backgroundColor: style.backgroundColor }
      : {};
  switch (pattern) {
    case 'grid':
      return {
        ...fill,
        backgroundImage: `linear-gradient(${line}), linear-gradient(90deg, ${line})`,
        backgroundSize: '10px 10px',
      };
    case 'dots':
      return {
        ...fill,
        backgroundImage: `radial-gradient(${line})`,
        backgroundSize: '10px 10px',
      };
    case 'lines':
      return {
        ...fill,
        backgroundImage: `linear-gradient(${line})`,
        backgroundSize: '10px 10px',
      };
    case 'image':
      return style.image
        ? {
            ...fill,
            backgroundImage: `url("${style.image.src}")`,
            backgroundSize: 'auto 50%',
          }
        : fill;
    case 'blank':
      return fill;
  }
}

function PatternPreview({
  pattern,
  style,
  selected,
  label,
  onSelect,
}: {
  pattern: CanvasPattern;
  style: CanvasStyle;
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="group cursor-pointer text-left"
    >
      <div
        className={cn(
          'relative aspect-[4/3] overflow-hidden rounded-xl p-1.5 transition-all duration-200',
          selected
            ? 'bg-card shadow-ambient ring-2 ring-accent-navy/20'
            : 'bg-input ring-1 ring-border-subtle/70 hover:bg-card-active hover:shadow-ambient hover:ring-text-muted/40',
        )}
      >
        {selected && (
          <div className="absolute top-1 right-1 z-10 flex size-4 items-center justify-center rounded-full bg-accent-navy">
            <Check className="size-2.5 text-text-on-dark" />
          </div>
        )}
        <div
          className="flex h-full w-full items-center justify-center rounded-lg"
          style={patternPreviewStyle(pattern, style)}
        >
          {pattern === 'image' && !style.image && (
            <ImagePlus className="size-5 text-text-muted" />
          )}
        </div>
      </div>
      <span
        className={cn(
          'mt-1.5 block text-center text-[11px] transition-colors',
          selected
            ? 'font-semibold text-text-brand'
            : 'text-text-muted group-hover:text-text-primary',
        )}
      >
        {label}
      </span>
    </button>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h3 className="m-0 mb-2 font-normal text-[10px] text-text-muted uppercase tracking-widest">
      {children}
    </h3>
  );
}

/**
 * Edits a canvas style; used for both the global default and a single canvas.
 * `compact` drops the row descriptions and labels the sections, for the in-canvas popover.
 */
export function CanvasStyleEditor({
  style,
  onChange,
  compact = false,
}: {
  style: CanvasStyle;
  onChange: (patch: Partial<CanvasStyle>) => void;
  compact?: boolean;
}) {
  const strings = useMessages();
  const styleStrings = strings.settings.canvasStyle;
  const bgColorStrings = styleStrings.backgroundColor;
  const [picker, setPicker] = useState<ColorField | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePattern = (pattern: CanvasPattern) => {
    if (pattern === 'image' && !style.image) {
      fileInputRef.current?.click();
      return;
    }
    onChange({ pattern });
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again still fires change.
    event.target.value = '';
    if (!file) {
      return;
    }
    try {
      onChange({ pattern: 'image', image: await createBackgroundImage(file) });
    } catch (error) {
      logger.error('Failed to load background image', error);
      toast.error(styleStrings.image.failed);
    }
  };

  const colorRow = (
    field: ColorField,
    mode: CanvasColorMode,
    themeSwatch: string,
    label: string,
    description: string,
  ) => {
    const segmented = {
      value: mode,
      onChange: (next: CanvasColorMode) => {
        onChange(
          field === 'backgroundColor'
            ? { backgroundColorMode: next }
            : { patternColorMode: next },
        );
        setPicker(next === 'custom' ? field : null);
      },
      options: [
        // A CSS var, not a resolved value, so the chip re-resolves on theme toggle.
        {
          value: 'theme',
          label: bgColorStrings.options.theme,
          swatch: themeSwatch,
        },
        {
          value: 'custom',
          label: bgColorStrings.options.custom,
          swatch: style[field],
        },
      ] as const,
    };
    return compact ? (
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-text-primary text-xs">{label}</span>
        <OptionsSegmented {...segmented} />
      </div>
    ) : (
      <OptionsRow {...segmented} label={label} description={description} />
    );
  };

  const hasPattern =
    style.pattern === 'grid' ||
    style.pattern === 'dots' ||
    style.pattern === 'lines';

  const chooseImageButton = (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      className="flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-card/70 px-3 py-1.5 font-medium text-text-primary text-xs ring-1 ring-border-ghost transition-colors hover:bg-card-active"
    >
      <ImagePlus className="size-3.5" />
      {styleStrings.image.choose}
    </button>
  );

  return (
    <div>
      {compact && <SectionLabel>{styleStrings.sections.pattern}</SectionLabel>}
      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        {PATTERNS.map((pattern) => (
          <PatternPreview
            key={pattern}
            pattern={pattern}
            style={style}
            selected={style.pattern === pattern}
            label={styleStrings.options[pattern]}
            onSelect={() => handlePattern(pattern)}
          />
        ))}
      </div>

      {compact && (
        <div className="mt-5">
          <SectionLabel>{styleStrings.sections.colors}</SectionLabel>
        </div>
      )}
      <div className={compact ? 'space-y-1.5' : 'mt-5 space-y-3'}>
        {colorRow(
          'backgroundColor',
          style.backgroundColorMode,
          'var(--bg-page)',
          bgColorStrings.label,
          bgColorStrings.description,
        )}
        {hasPattern &&
          colorRow(
            'patternColor',
            style.patternColorMode,
            'var(--canvas-grid)',
            styleStrings.patternColor.label,
            styleStrings.patternColor.description,
          )}
        {style.pattern === 'image' &&
          (compact ? (
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-text-primary text-xs">
                {styleStrings.image.label}
              </span>
              {chooseImageButton}
            </div>
          ) : (
            <div className="flex w-full flex-col gap-3 rounded-xl bg-input/40 px-4 py-3 ring-1 ring-border-subtle/70 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="block font-medium text-sm text-text-primary">
                  {styleStrings.image.label}
                </span>
                <span className="mt-1 block text-text-muted text-xs leading-relaxed">
                  {styleStrings.image.description}
                </span>
              </span>
              {chooseImageButton}
            </div>
          ))}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleFile(event)}
      />

      <ColorPickerDialog
        open={picker !== null}
        initialColor={picker ? style[picker] : style.backgroundColor}
        title={
          picker === 'patternColor'
            ? styleStrings.patternColor.label
            : bgColorStrings.label
        }
        confirmLabel={bgColorStrings.confirm}
        onConfirm={(hex) => {
          if (picker) {
            onChange({ [picker]: hex });
          }
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
    </div>
  );
}
