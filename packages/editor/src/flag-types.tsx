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
import { type Messages, useMessages } from './i18n';
import type { FlagType } from './sync/repo/types';
import { useRepository } from './sync/repo-context';

export const FLAG_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#6b7280',
];

export interface FlagTypesContextValue {
  /** Never empty: the localized defaults stand in until the user first edits the list. */
  types: FlagType[];
  setTypes: (types: readonly FlagType[]) => Promise<void>;
}

const FlagTypesContext = createContext<FlagTypesContextValue | null>(null);
const logger = new Logger('FlagTypes');

// Fixed ids so flags placed before the list is first saved keep their type.
function defaultFlagTypes(strings: Messages): FlagType[] {
  const names = strings.canvas.flagTypes;
  return [
    { id: 'todo', name: names.todo, color: '#ef4444' },
    { id: 'review', name: names.review, color: '#eab308' },
    { id: 'examinable', name: names.examinable, color: '#22c55e' },
  ];
}

export function FlagTypesProvider({ children }: PropsWithChildren) {
  const repository = useRepository();
  const strings = useMessages();
  const [stored, setStored] = useState<FlagType[]>([]);

  useEffect(() => {
    let cancelled = false;
    repository
      .getFlagTypes()
      .then((loaded) => {
        if (!cancelled) {
          setStored(loaded);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          logger.error('Failed to load flag types', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const setTypes = useCallback(
    async (types: readonly FlagType[]) => {
      setStored(await repository.setFlagTypes(types));
    },
    [repository],
  );

  const value = useMemo(
    () => ({
      types: stored.length > 0 ? stored : defaultFlagTypes(strings),
      setTypes,
    }),
    [setTypes, stored, strings],
  );

  return (
    <FlagTypesContext.Provider value={value}>
      {children}
    </FlagTypesContext.Provider>
  );
}

export function useFlagTypes(): FlagTypesContextValue {
  const context = useContext(FlagTypesContext);
  if (!context) {
    throw new Error('useFlagTypes must be used within a FlagTypesProvider.');
  }
  return context;
}
