import { createContext, useContext, useEffect, useState } from 'react';
import { UserPrefs } from '@/lib/user-prefs';
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

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(getInitialLocale);

  useEffect(
    () =>
      UserPrefs.subscribe('language', (value) => {
        setLocaleState(resolveLocale(value));
      }),
    [],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (nextLocale: SupportedLocale) => {
    UserPrefs.set('language', nextLocale);
  };

  return (
    <I18nContext.Provider
      value={{ locale, messages: catalogs[locale], setLocale }}
    >
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
