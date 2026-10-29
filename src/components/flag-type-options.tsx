import { useState } from 'react';
import { Flag, Pencil, Plus, Trash2 } from 'lucide-react';
import { ColorSwatch } from '@myelin/editor/components/color-swatch';
import { resolveFlagType } from '@myelin/editor/elements/flag-element';
import { FLAG_COLORS, useFlagTypes } from '@myelin/editor/flag-types';
import { useMessages } from '@myelin/editor/i18n';
import type { FlagType } from '@myelin/editor/sync/repo/types';
import type { ToolOption } from '@myelin/editor/tools/tool';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';

const logger = new Logger('FlagTypeOptions');

// No hover tint: it would stack on the row's own hover tint.
const rowButtonClass =
  'flex pointer-coarse:size-8 size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-text-muted transition-colors hover:text-text-primary';

export function FlagTypeOptions({
  option,
}: {
  option: Extract<ToolOption, { type: 'flag' }>;
}) {
  const labels = useMessages().canvas.flagTypes;
  const { types, setTypes } = useFlagTypes();
  const [editingId, setEditingId] = useState<string | null>(null);
  const active = resolveFlagType(types, option.value);

  const save = (next: FlagType[]) => {
    setTypes(next).catch((error) => {
      logger.error('Failed to save flag types', error);
    });
  };
  const update = (id: string, changes: Partial<FlagType>) =>
    save(
      types.map((type) => (type.id === id ? { ...type, ...changes } : type)),
    );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="select-none font-medium text-text-muted text-xs">
        {option.label}
      </span>
      <div className="flex flex-col gap-0.5">
        {types.map((type) =>
          type.id === editingId ? (
            <FlagTypeEditor
              key={type.id}
              type={type}
              onChange={(changes) => update(type.id, changes)}
              onDone={() => setEditingId(null)}
            />
          ) : (
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
                <Flag
                  className="size-3.5 shrink-0"
                  style={{ color: type.color }}
                />
                <span className="truncate">{type.name}</span>
              </button>
              <button
                type="button"
                onClick={() => setEditingId(type.id)}
                aria-label={labels.edit}
                title={labels.edit}
                className={rowButtonClass}
              >
                <Pencil className="size-3" />
              </button>
              {types.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    save(types.filter((candidate) => candidate !== type))
                  }
                  aria-label={labels.remove}
                  title={labels.remove}
                  className={rowButtonClass}
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          ),
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          const used = new Set(types.map((type) => type.color));
          const color =
            FLAG_COLORS.find((candidate) => !used.has(candidate)) ??
            FLAG_COLORS[0];
          const id = crypto.randomUUID();
          save([...types, { id, name: labels.newFlag, color }]);
          option.set(id);
          setEditingId(id);
        }}
        className="flex pointer-coarse:min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border-none bg-surface px-2.5 py-1.5 font-medium text-text-secondary text-xs transition-colors hover:bg-card-active hover:text-text-primary"
      >
        <Plus className="size-3.5 shrink-0" />
        {labels.newFlag}
      </button>
    </div>
  );
}

function FlagTypeEditor({
  type,
  onChange,
  onDone,
}: {
  type: FlagType;
  onChange: (changes: Partial<FlagType>) => void;
  onDone: () => void;
}) {
  const labels = useMessages().canvas.flagTypes;
  const [name, setName] = useState(type.name);
  const commit = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== type.name) {
      onChange({ name: trimmed });
    }
    onDone();
  };

  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface p-2">
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            onDone();
          }
        }}
        aria-label={labels.name}
        placeholder={labels.name}
        className="w-full rounded-md bg-card px-2 py-1.5 text-text-primary text-xs outline-none"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {FLAG_COLORS.map((color) => (
          <ColorSwatch
            key={color}
            color={color}
            active={type.color === color}
            // Keeps focus in the name field so its blur doesn't close the editor first.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onChange({ color })}
          />
        ))}
      </div>
    </div>
  );
}
