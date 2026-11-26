import type { FolderNameRule, VFSFolderNode } from '@/lib/sync';

export const NAME_PATTERN_TOKENS = [
  '{date}',
  '{date:short}',
  '{date:full}',
  '{time}',
  '{weekday}',
] as const;

const TOKEN_FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: 'long' },
  'date:short': { dateStyle: 'short' },
  'date:full': { dateStyle: 'full' },
  time: { timeStyle: 'short' },
  weekday: { weekday: 'long' },
};

/** Unknown tokens stay literal. */
export function renderNamePattern(
  pattern: string,
  date: Date,
  locale: string,
): string {
  return pattern.replace(/\{([^{}]+)\}/g, (match, token: string) => {
    const options = TOKEN_FORMATS[token];
    return options
      ? new Intl.DateTimeFormat(locale, options).format(date)
      : match;
  });
}

export const TEMPLATE_FIELD_TOKENS = [
  '{title}',
  '{folder}',
  ...NAME_PATTERN_TOKENS,
];

/** `folder` is the containing folder's name, empty at the library root. */
export function renderTemplateFields(
  text: string,
  title: string,
  folder: string,
  date: Date,
  locale: string,
): string {
  // Names last and in one pass, so a name that itself contains "{date}" or "{title}" isn't expanded.
  return renderNamePattern(text, date, locale).replace(
    /\{(title|folder)\}/g,
    (_, token: string) => (token === 'title' ? title : folder),
  );
}

/** Trims trailing whitespace and dangling separators left by a half-typed name like "July 10 - ". */
export function cleanName(name: string): string {
  return name.trimStart().replace(/[\s\-–—:,|]+$/, '');
}

/**
 * `folderChain` runs root to the target folder. `null` when no rule applies: nothing set, or
 * every folder up to the root inherits.
 */
export function resolveNamePattern(
  folderChain: readonly VFSFolderNode[],
): string | null {
  for (let i = folderChain.length - 1; i >= 0; i--) {
    const rule: FolderNameRule | undefined = folderChain[i].nameRule;
    if (rule?.mode === 'custom') {
      return rule.pattern;
    }
    if (rule?.mode !== 'inherit') {
      return null;
    }
  }
  return null;
}
