/**
 * Unified persistence layer for user preferences.
 *
 * Add a new preference by adding one line to PREFS — the storage key,
 * default value, and TypeScript type are all derived from that single
 * declaration. No other code should touch localStorage directly.
 */

import type { RepositoryConfig } from './sync/repo/config';

const PREFIX = 'myelin:';

/* ── Single-source pref declarations ─────────────────────── */

function pref<T>(storageKey: string, defaultValue: T) {
  return { storageKey: PREFIX + storageKey, defaultValue };
}

const PREFS = {
  keybindings: pref<Record<string, import('@/lib/keybinds').KeyCombo>>(
    'keybindings',
    {},
  ),
  wheelTools: pref<number[]>('wheel-tools', []),
  toolOptions: pref<Record<string, Record<string, unknown>>>(
    'tool-options',
    {},
  ),
  canvasBackground: pref<'grid' | 'dots' | 'blank'>(
    'canvas-background',
    'dots',
  ),
  pageFrameEditFitWholePage: pref<boolean>(
    'page-frame-edit-fit-whole-page',
    true,
  ),
  defaultPageLayout: pref<'vertical' | 'horizontal'>(
    'default-page-layout',
    'vertical',
  ),
  noteLinkHoverPreview: pref<boolean>('note-link-hover-preview', true),
  linkRequireModifier: pref<boolean>('link-require-modifier', true),
  alwaysRenameNoteReferences: pref<boolean>(
    'always-rename-note-references',
    false,
  ),
  language: pref<string>('language', 'en'),
  repositoryConfig: pref<RepositoryConfig>('repository-config', {
    kind: 'local',
  }),
  githubVaultPassword: pref<string>('github-vault-password', ''),
  peerId: pref<string>('peer-id', ''),
  explorerViewMode: pref<'tree' | 'grid'>('explorer-view-mode', 'tree'),
  windowLayout: pref<unknown | null>('window-layout', null),
};

export type UserPrefsKey = keyof typeof PREFS;
export type UserPrefValue<K extends UserPrefsKey> =
  (typeof PREFS)[K]['defaultValue'];
type PrefKey = UserPrefsKey;
type PrefValue<K extends PrefKey> = UserPrefValue<K>;
type Listener<K extends PrefKey> = (value: PrefValue<K>) => void;
const listeners = new Map<PrefKey, Set<Listener<never>>>();

// Keep this as a plain module export rather than a TypeScript namespace:
// namespaces emit extra runtime JS in our ESM setup, while this object keeps
// the API grouped without adding another compiled wrapper.
export const UserPrefs = {
  get<K extends PrefKey>(key: K): PrefValue<K> {
    const { storageKey, defaultValue } = PREFS[key];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) {
        return JSON.parse(raw);
      }
    } catch {
      /* corrupt data — fall through to default */
    }
    return structuredClone(defaultValue) as PrefValue<K>;
  },

  set<K extends PrefKey>(key: K, value: PrefValue<K>): void {
    localStorage.setItem(PREFS[key].storageKey, JSON.stringify(value));
    const subs = listeners.get(key);
    if (subs) {
      for (const fn of subs) {
        (fn as Listener<K>)(value);
      }
    }
  },

  update<K extends PrefKey>(
    key: K,
    updater: (current: PrefValue<K>) => PrefValue<K>,
  ): void {
    const current = UserPrefs.get(key);
    UserPrefs.set(key, updater(current));
  },

  subscribe<K extends PrefKey>(key: K, fn: Listener<K>): () => void {
    let subs = listeners.get(key);
    if (!subs) {
      subs = new Set();
      listeners.set(key, subs);
    }
    subs.add(fn as Listener<never>);
    return () => {
      subs!.delete(fn as Listener<never>);
    };
  },

  remove<K extends PrefKey>(key: K): void {
    localStorage.removeItem(PREFS[key].storageKey);
    const subs = listeners.get(key);
    if (subs) {
      const def = structuredClone(PREFS[key].defaultValue) as PrefValue<K>;
      for (const fn of subs) {
        (fn as Listener<K>)(def);
      }
    }
  },
} as const;
