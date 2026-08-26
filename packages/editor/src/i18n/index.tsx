import { createContext, useContext, useEffect, useState } from 'react';
import { UserPrefs } from '../user-prefs';
import {
  catalogs,
  defaultLocale,
  localeLabels,
  type MessageGetter,
  type Messages,
  type SupportedLocale,
} from './messages';

interface I18nContextValue {
  locale: SupportedLocale;
  messages: Messages;
  setLocale: (locale: SupportedLocale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// Mirror of the active catalog for imperative code outside the React tree (e.g. canvas chrome
// rendered through its own createRoot). Kept in sync by I18nProvider.
let activeMessages: Messages = catalogs[defaultLocale];

export function getMessages(): Messages {
  return activeMessages;
}

function resolveLocale(input: string | null | undefined): SupportedLocale {
  if (!input) {
    return defaultLocale;
  }

  const normalized = input.toLowerCase();
  if (normalized in catalogs) {
    return normalized as SupportedLocale;
  }

  const base = normalized.split('-')[0];
  if (base in catalogs) {
    return base as SupportedLocale;
  }

  return defaultLocale;
}

function getInitialLocale(): SupportedLocale {
  const preferred = UserPrefs.get('language');
  if (preferred) {
    return resolveLocale(preferred);
  }

  if (typeof navigator !== 'undefined') {
    return resolveLocale(navigator.language);
  }

  return defaultLocale;
}

interface I18nProviderProps {
  children: React.ReactNode;
  /**
   * Pin the locale instead of following the `language` preference. The website serves one
   * prerendered page per locale, so the URL decides the language and a stray preference from a
   * previous visit must not override it.
   */
  locale?: SupportedLocale;
}

export function I18nProvider({
  children,
  locale: pinnedLocale,
}: I18nProviderProps) {
  const [prefLocale, setPrefLocale] =
    useState<SupportedLocale>(getInitialLocale);
  const locale = pinnedLocale ?? prefLocale;

  useEffect(
    () =>
      UserPrefs.subscribe('language', (value) => {
        setPrefLocale(resolveLocale(value));
      }),
    [],
  );

  useEffect(() => {
    // A pinned locale means the document already carries the right `lang` from
    // the server (in its canonical casing), so leave it alone.
    if (!pinnedLocale) {
      document.documentElement.lang = locale;
    }
  }, [locale, pinnedLocale]);

  const setLocale = (nextLocale: SupportedLocale) => {
    UserPrefs.set('language', nextLocale);
  };

  const messages = catalogs[locale];
  // Set during render, not an effect, so it is current before descendant effects build imperative
  // UI like the canvas chrome.
  activeMessages = messages;

  return (
    <I18nContext.Provider value={{ locale, messages, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider.');
  }
  return context;
}

export function useLocale() {
  return useI18n().locale;
}

export function useMessages() {
  return useI18n().messages;
}

export {
  localeLabels,
  type MessageGetter,
  type Messages,
  type SupportedLocale,
};
