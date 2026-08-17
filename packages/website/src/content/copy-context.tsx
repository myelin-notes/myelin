import { createContext, type ReactNode, useContext } from 'react';
import { getCopy, type SiteCopy } from '@/content/site';
import type { Locale } from '@/lib/locale';

/**
 * The site's own copy, for the React components inside the canvas island. The
 * locale comes from the URL (one prerendered page per language), so it enters
 * the tree once here rather than being threaded through every scene component.
 *
 * The editor's own UI strings are separate: those come from `useMessages` and
 * the `I18nProvider` that wraps this one.
 */
const CopyContext = createContext<SiteCopy | null>(null);

export function SiteCopyProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <CopyContext.Provider value={getCopy(locale)}>
      {children}
    </CopyContext.Provider>
  );
}

export function useCopy(): SiteCopy {
  const copy = useContext(CopyContext);
  if (!copy) {
    throw new Error('useCopy must be used within a SiteCopyProvider.');
  }
  return copy;
}
