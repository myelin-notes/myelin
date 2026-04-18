import en from './en';
import es from './es';
import zhHans from './zh-Hans';

export const localeLabels = {
  en: 'English',
  es: 'Español',
  'zh-hans': '简体中文',
} as const;

export type SupportedLocale = keyof typeof localeLabels;
export type Messages = typeof en;

export const defaultLocale: SupportedLocale = 'en';
export const catalogs: Record<SupportedLocale, Messages> = {
  en,
  es,
  'zh-hans': zhHans,
};
