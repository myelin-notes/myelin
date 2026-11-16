import { type Locale, localeTags } from '@/lib/locale';

// Display only: the charged amount is set on the Polar products.
const usd = { free: 0, pro: 49.99, student: 29.99 };

export function formatPrice(locale: Locale, plan: keyof typeof usd): string {
  return new Intl.NumberFormat(localeTags[locale], {
    style: 'currency',
    currency: 'USD',
    trailingZeroDisplay: 'stripIfInteger',
  }).format(usd[plan]);
}
