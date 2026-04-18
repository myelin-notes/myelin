import { useEffect, useState } from 'react';
import {
  formatRelativeTime,
  getRelativeTimeUpdateInterval,
} from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n';

interface TimeAgoProps {
  date: Date | string | number;
}

export function TimeAgo({ date }: TimeAgoProps) {
  const locale = useLocale();
  const [text, setText] = useState(() => formatRelativeTime(date, locale));

  useEffect(() => {
    const update = () => setText(formatRelativeTime(date, locale));
    update();
    const diffMs = new Date(date).getTime() - Date.now();
    const interval = setInterval(update, getRelativeTimeUpdateInterval(diffMs));
    return () => clearInterval(interval);
  }, [date, locale]);

  return <time dateTime={new Date(date).toISOString()}>{text}</time>;
}
