import en from './en';
import es from './es';

export const localeLabels = {
  en: 'English',
  es: 'Español',
} as const;

export type SupportedLocale = keyof typeof localeLabels;
export type Messages = typeof en;

export const defaultLocale: SupportedLocale = 'en';
export const catalogs: Record<SupportedLocale, Messages> = {
  en,
  es,
};
