import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Logger } from '@myelin/shared/logger';
import type { Messages } from './i18n';
import { MAX_PEN_PRESETS } from './sync/repo/config';
import type { PenPreset, PenPresetChanges } from './sync/repo/types';
import { useRepository } from './sync/repo-context';

export interface PenPresetsContextValue {
  presets: PenPreset[];
  // False once the list is full. Callers drop their save affordance rather than
  // offering one that can only fail.
  canAddPreset: boolean;
  addPreset: (preset: Omit<PenPreset, 'id'>) => Promise<void>;
  updatePreset: (id: string, changes: PenPresetChanges) => Promise<void>;
  removePreset: (id: string) => Promise<void>;
}

// Exported so hosts without a repository (e.g. the marketing website) can mount
// their own provider that the editor's toolbars still read from.
export const PenPresetsContext = createContext<PenPresetsContextValue | null>(
  null,
);
const logger = new Logger('PenPresets');

export function PenPresetsProvider({ children }: PropsWithChildren) {
  const repository = useRepository();
  const [presets, setPresets] = useState<PenPreset[]>([]);

  useEffect(() => {
    let cancelled = false;
    repository
      .getPenPresets()
      .then((loaded) => {
        if (!cancelled) {
          setPresets(loaded);
        }
      })
      .catch((error) => {
        logger.error('Failed to load pen presets', error);
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const addPreset = useCallback(
    async (preset: Omit<PenPreset, 'id'>) => {
      setPresets(await repository.addPenPreset(preset));
    },
    [repository],
  );

  const updatePreset = useCallback(
    async (id: string, changes: PenPresetChanges) => {
      setPresets(await repository.updatePenPreset(id, changes));
    },
    [repository],
  );

  const removePreset = useCallback(
    async (id: string) => {
      setPresets(await repository.removePenPreset(id));
    },
    [repository],
  );

  const value = useMemo(
    () => ({
      presets,
      canAddPreset: presets.length < MAX_PEN_PRESETS,
      addPreset,
      updatePreset,
      removePreset,
    }),
    [addPreset, presets, removePreset, updatePreset],
  );

  return (
    <PenPresetsContext.Provider value={value}>
      {children}
    </PenPresetsContext.Provider>
  );
}

export function usePenPresets(): PenPresetsContextValue {
  const context = useContext(PenPresetsContext);
  if (!context) {
    throw new Error('usePenPresets must be used within a PenPresetsProvider.');
  }
  return context;
}

/** Presets have no name of their own: `Pen · 12px`. */
export function getPenPresetLabel(
  preset: PenPreset,
  strings: Messages,
): string {
  return strings.canvas.toolPresets.label(
    strings.canvas.tools[preset.tool],
    preset.size,
  );
}
