import type { SupportedLocale } from '@myelin/editor/i18n/messages';

/**
 * Locales the marketing site ships copy for. A subset of the app's locales
 * (`SupportedLocale`), because a site locale needs hand-written marketing copy,
 * not just an app catalog. The `Extract` keeps the two from drifting apart in
 * naming: a typo here stops compiling.
 */
export const LOCALES = ['en', 'es', 'fr', 'zh-hans'] as const;

export type Locale = Extract<SupportedLocale, (typeof LOCALES)[number]>;

export const DEFAULT_LOCALE: Locale = 'en';

/** Names in their own language, for the picker. */
export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  'zh-hans': '简体中文',
};

/**
 * BCP 47 tags for `<html lang>` and `hreflang`. Our route segments are
 * lowercase (`/zh-hans/`); the tag keeps the script subtag's canonical casing.
 */
export const localeTags: Record<Locale, string> = {
  en: 'en',
  es: 'es',
  fr: 'fr',
  'zh-hans': 'zh-Hans',
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * The locale a pathname is served under, and the same path with its locale
 * prefix removed. `/es/privacy` -> `{ locale: 'es', path: '/privacy' }`, and
 * an unprefixed path is the default locale.
 */
export function splitLocalePath(pathname: string): {
  locale: Locale;
  path: string;
} {
  const [, first = '', ...rest] = pathname.split('/');
  if (isLocale(first)) {
    return { locale: first, path: `/${rest.join('/')}` };
  }
  return { locale: DEFAULT_LOCALE, path: pathname };
}

/** The path a route lives at in a given locale. The default locale has no prefix. */
export function localizePath(path: string, locale: Locale): string {
  const clean = path.replace(/^\/+/, '');
  if (locale === DEFAULT_LOCALE) {
    return `/${clean}`;
  }
  return clean ? `/${locale}/${clean}` : `/${locale}/`;
}
