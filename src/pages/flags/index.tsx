import { useEffect, useState } from 'react';
import { ChevronRight, Flag, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { resolveFlagType } from '@myelin/editor/elements/flag-element';
import { useFlagTypes } from '@myelin/editor/flag-types';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import { formatNumber } from '@myelin/editor/i18n/format';
import type { FlagType } from '@myelin/editor/sync/repo/types';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';
import { errorDescription } from '@/components/command-palette/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { openNote } from '@/lib/note/navigation';
import { useRepository, useRepositoryStatus } from '@/lib/sync';
import type { FlagEdit, NoteFlag } from '@/lib/sync/repo/types';
import { useTabController } from '@/lib/tabs/context';
import { setFlagsFilter, useFlagsFilter } from './filter';

const logger = new Logger('FlagsPage');

const toolbarButtonClass =
  'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 font-medium text-text-secondary text-xs transition-colors hover:bg-hover-tint hover:text-text-primary';

const chipClass =
  'flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 font-medium text-xs transition-colors';
const chipOffClass =
  'border-border-subtle text-text-muted hover:bg-hover-tint hover:text-text-primary';

// Duplicated notes copy their flags' ids, so an id alone is not unique.
function flagKey(flag: NoteFlag): string {
  return `${flag.noteId}/${flag.id}`;
}

export function FlagsPage() {
  const strings = useMessages();
  const labels = strings.flagsPage;
  const locale = useLocale();
  const repository = useRepository();
  const { dataVersion } = useRepositoryStatus();
  const tabController = useTabController();
  const { types } = useFlagTypes();
  const filter = useFlagsFilter();
  const [flags, setFlags] = useState<NoteFlag[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dataVersion and reloadKey are change triggers
  useEffect(() => {
    let cancelled = false;
    repository.listFlags().then(
      (next) => {
        if (!cancelled) {
          setFlags(next);
          setFailed(false);
        }
      },
      (error) => {
        logger.error('Failed to list flags', error);
        if (!cancelled) {
          setFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repository, dataVersion, reloadKey]);

  const query = filter.query.trim().toLocaleLowerCase();
  // Ignores ids of types deleted since they were picked, which would otherwise hide every flag.
  const activeTypeIds = filter.typeIds.filter((id) =>
    types.some((type) => type.id === id),
  );
  const typeCounts = new Map<FlagType, number>();
  let matchCount = 0;
  const groups = new Map<string, { type: FlagType; flag: NoteFlag }[]>();
  for (const flag of flags ?? []) {
    if (
      query &&
      ![flag.label, flag.noteName, ...flag.folderPath].some((text) =>
        text.toLocaleLowerCase().includes(query),
      )
    ) {
      continue;
    }
    const type = resolveFlagType(types, flag.flagTypeId);
    if (!type) {
      continue;
    }
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    matchCount++;
    if (activeTypeIds.length > 0 && !activeTypeIds.includes(type.id)) {
      continue;
    }
    let group = groups.get(flag.noteId);
    if (!group) {
      group = [];
      groups.set(flag.noteId, group);
    }
    group.push({ type, flag });
  }
  const notes = [...groups.values()].sort(
    (a, b) => b[0].flag.noteModifiedAt - a[0].flag.noteModifiedAt,
  );
  const visible = notes.flat().map(({ flag }) => flag);
  // Only what is on screen, so flags hidden by a later filter change are never edited.
  const selectedFlags = visible.filter((flag) => selected.has(flagKey(flag)));

  const select = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    for (const key of keys) {
      if (on) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }
    setSelected(next);
  };

  const toggleType = (id: string) =>
    setFlagsFilter({
      typeIds: activeTypeIds.includes(id)
        ? activeTypeIds.filter((active) => active !== id)
        : [...activeTypeIds, id],
    });

  const applyEdit = (edit: FlagEdit) => {
    repository.editFlags(selectedFlags, edit).then(
      () => {
        setSelected(new Set());
        setReloadKey((key) => key + 1);
      },
      (error) => {
        logger.error('Failed to edit flags', error, { action: edit.action });
        toast.error(labels.editFailed, {
          description: errorDescription(error),
        });
      },
    );
  };

  return (
    <div className="relative flex h-full w-full bg-page">
      <main className="flex-1 overflow-y-auto px-6 pt-8 pb-12 sm:px-8 md:px-10 md:pt-12 lg:px-12">
        <div className="mx-auto w-full max-w-3xl">
          <h1
            className="mb-8 font-extralight font-heading text-text-primary tracking-tight"
            style={{ fontSize: 'var(--fluid-display)' }}
          >
            {labels.title}
          </h1>

          <label className="flex h-9 items-center gap-2 rounded-xl bg-card px-3 ring-1 ring-border-subtle/70 focus-within:ring-accent-dark/15">
            <Search className="size-3.5 shrink-0 text-text-muted" />
            <input
              type="text"
              value={filter.query}
              onChange={(event) =>
                setFlagsFilter({ query: event.target.value })
              }
              placeholder={labels.searchPlaceholder}
              aria-label={labels.searchPlaceholder}
              className="w-full min-w-0 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={activeTypeIds.length === 0}
              onClick={() => setFlagsFilter({ typeIds: [] })}
              className={cn(
                chipClass,
                activeTypeIds.length === 0
                  ? 'border-transparent bg-accent-dark text-text-on-dark'
                  : chipOffClass,
              )}
            >
              {labels.allTypes}
              <span className="tabular-nums opacity-70">
                {formatNumber(matchCount, locale)}
              </span>
            </button>
            {types.map((type) => {
              const active = activeTypeIds.includes(type.id);
              return (
                <button
                  key={type.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleType(type.id)}
                  className={cn(
                    chipClass,
                    active ? 'text-text-primary' : chipOffClass,
                  )}
                  style={
                    active
                      ? {
                          borderColor: type.color,
                          backgroundColor: `color-mix(in srgb, ${type.color} 16%, transparent)`,
                        }
                      : undefined
                  }
                >
                  {/* Filled only while active, so the icon carries the state too. */}
                  <Flag
                    className="size-3.5 shrink-0"
                    style={{
                      color: type.color,
                      fill: active ? type.color : 'none',
                    }}
                  />
                  <span className="max-w-40 truncate">{type.name}</span>
                  <span className="tabular-nums opacity-70">
                    {formatNumber(typeCounts.get(type) ?? 0, locale)}
                  </span>
                </button>
              );
            })}
          </div>

          {visible.length > 0 && (
            <div className="mt-6 flex h-10 items-center gap-2 border-border-subtle border-b px-2">
              <Checkbox
                checked={selectedFlags.length === visible.length}
                onCheckedChange={(checked) =>
                  select(visible.map(flagKey), checked)
                }
                aria-label={labels.selectAll}
              />
              <span className="text-text-secondary text-xs tabular-nums">
                {selectedFlags.length > 0
                  ? labels.selected(selectedFlags.length)
                  : labels.selectAll}
              </span>
              {selectedFlags.length > 0 && (
                <div className="ml-auto flex items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger className={toolbarButtonClass}>
                      {labels.changeType}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      sideOffset={4}
                      className="min-w-[160px] rounded-xl bg-page p-1.5 shadow-ambient"
                    >
                      {types.map((type) => (
                        <DropdownMenuItem
                          key={type.id}
                          onClick={() =>
                            applyEdit({
                              action: 'set-type',
                              flagTypeId: type.id,
                            })
                          }
                          className="gap-2 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
                        >
                          <Flag
                            className="size-3.5 shrink-0"
                            style={{ color: type.color, fill: type.color }}
                          />
                          <span className="truncate">{type.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className={cn(
                      toolbarButtonClass,
                      'text-destructive hover:text-destructive',
                    )}
                  >
                    {labels.delete}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    aria-label={strings.common.clear}
                    title={strings.common.clear}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-hover-tint hover:text-text-primary"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-2 space-y-1">
            {failed && (
              <p className="m-0 px-2 text-destructive text-sm">
                {labels.loadFailed}
              </p>
            )}
            {!failed && flags?.length === 0 && (
              <p className="m-0 px-2 text-sm text-text-muted">{labels.empty}</p>
            )}
            {!failed && !!flags?.length && notes.length === 0 && (
              <p className="m-0 px-2 text-sm text-text-muted">
                {labels.noMatches}
              </p>
            )}
            {notes.map((entries) => {
              const note = entries[0].flag;
              const keys = entries.map(({ flag }) => flagKey(flag));
              const isCollapsed = collapsed.has(note.noteId);
              return (
                <section key={note.noteId}>
                  <div className="flex items-center gap-2 rounded-md pl-2 transition-colors hover:bg-hover-tint">
                    <Checkbox
                      checked={keys.every((key) => selected.has(key))}
                      onCheckedChange={(checked) => select(keys, checked)}
                      aria-label={note.noteName}
                    />
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      onClick={() => {
                        const next = new Set(collapsed);
                        if (!next.delete(note.noteId)) {
                          next.add(note.noteId);
                        }
                        setCollapsed(next);
                      }}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-2 text-left"
                    >
                      <ChevronRight
                        className={cn(
                          'size-3.5 shrink-0 text-text-muted transition-transform',
                          !isCollapsed && 'rotate-90',
                        )}
                      />
                      <span className="max-w-[60%] shrink-0 truncate font-medium text-sm text-text-primary">
                        {note.noteName}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-text-muted text-xs">
                        {note.folderPath.join(' / ')}
                      </span>
                      <span className="rounded-md bg-surface px-1.5 py-0.5 font-medium text-[11px] text-text-secondary tabular-nums">
                        {formatNumber(entries.length, locale)}
                      </span>
                    </button>
                  </div>
                  {/* ml-6.5 puts flag checkboxes under the chevron, past the 18px checkbox and 8px gap. */}
                  {!isCollapsed &&
                    entries.map(({ type, flag }, index) => {
                      const isSelected = selected.has(keys[index]);
                      return (
                        <div
                          key={keys[index]}
                          className={cn(
                            'ml-6.5 flex items-center gap-2 rounded-md pl-2 transition-colors hover:bg-hover-tint',
                            isSelected && 'bg-surface',
                          )}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) =>
                              select([keys[index]], checked)
                            }
                            aria-label={
                              flag.label || strings.canvas.flags.untitled
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              openNote(
                                tabController,
                                {
                                  fileType: 'mcanvas',
                                  id: flag.noteId,
                                  flagId: flag.id,
                                },
                                flag.noteName,
                              )
                            }
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 pr-2 text-left text-sm text-text-secondary transition-colors hover:text-text-primary"
                          >
                            <Flag
                              className="size-3.5 shrink-0"
                              style={{ color: type.color, fill: type.color }}
                            />
                            <span className="truncate">
                              {flag.label || strings.canvas.flags.untitled}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                </section>
              );
            })}
          </div>
        </div>
      </main>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {labels.deleteTitle(selectedFlags.length)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {labels.deleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{strings.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmingDelete(false);
                applyEdit({ action: 'remove' });
              }}
            >
              {labels.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
