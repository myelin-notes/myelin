import en from './en';
import es from './es';
import fr from './fr';
import tr from './tr';
import zhHans from './zh-Hans';

export const localeLabels = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  tr: 'Türkçe',
  'zh-hans': '简体中文',
} as const;

export type SupportedLocale = keyof typeof localeLabels;
export type Messages = typeof en;
export type MessageGetter = () => Messages;

export const defaultLocale: SupportedLocale = 'en';
export const catalogs: Record<SupportedLocale, Messages> = {
  en,
  es,
  fr,
  tr,
  'zh-hans': zhHans,
};
