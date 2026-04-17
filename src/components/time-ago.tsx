import { useEffect, useState } from 'react';

interface TimeAgoProps {
  date: Date | string | number;
}

const UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: 'year', seconds: 31536000 },
  { unit: 'month', seconds: 2592000 },
  { unit: 'week', seconds: 604800 },
  { unit: 'day', seconds: 86400 },
  { unit: 'hour', seconds: 3600 },
  { unit: 'minute', seconds: 60 },
];

function formatTimeAgo(date: Date | string | number, locale: string): string {
  const diffSeconds = Math.round(
    (new Date(date).getTime() - Date.now()) / 1000,
  );
  const absDiff = Math.abs(diffSeconds);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  for (const { unit, seconds } of UNITS) {
    if (absDiff >= seconds) {
      const value = Math.round(diffSeconds / seconds);
      return rtf.format(value, unit);
    }
  }

  return rtf.format(0, 'second');
}

function getUpdateInterval(diffMs: number): number {
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

export function TimeAgo({ date }: TimeAgoProps) {
  const locale =
    typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  const [text, setText] = useState(() => formatTimeAgo(date, locale));

  useEffect(() => {
    const update = () => setText(formatTimeAgo(date, locale));
    update();
    const diffMs = new Date(date).getTime() - Date.now();
    const interval = setInterval(update, getUpdateInterval(diffMs));
    return () => clearInterval(interval);
  }, [date, locale]);

  return <time dateTime={new Date(date).toISOString()}>{text}</time>;
}
