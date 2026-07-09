import { defaultLocale, type SupportedLocale } from './messages';

const RELATIVE_TIME_UNITS: {
  unit: Intl.RelativeTimeFormatUnit;
  seconds: number;
}[] = [
  { unit: 'year', seconds: 31_536_000 },
  { unit: 'month', seconds: 2_592_000 },
  { unit: 'week', seconds: 604_800 },
  { unit: 'day', seconds: 86_400 },
  { unit: 'hour', seconds: 3_600 },
  { unit: 'minute', seconds: 60 },
];

export function formatNumber(
  value: number,
  locale: SupportedLocale = defaultLocale,
): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatRelativeTime(
  date: Date | string | number,
  locale: SupportedLocale = defaultLocale,
  options?: { style?: Intl.RelativeTimeFormatStyle },
): string {
  const diffSeconds = Math.round(
    (new Date(date).getTime() - Date.now()) / 1000,
  );
  const absDiff = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: 'auto',
    style: options?.style ?? 'long',
  });

  for (const { unit, seconds } of RELATIVE_TIME_UNITS) {
    if (absDiff >= seconds) {
      return rtf.format(Math.round(diffSeconds / seconds), unit);
    }
  }

  return rtf.format(0, 'second');
}

export function getRelativeTimeUpdateInterval(diffMs: number): number {
  const absDiff = Math.abs(diffMs);
  if (absDiff < 60_000) {
    return 10_000;
  }
  if (absDiff < 3_600_000) {
    return 60_000;
  }
  if (absDiff < 86_400_000) {
    return 300_000;
  }
  return 3_600_000;
}
