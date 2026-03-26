/**
 * Unified persistence layer for user preferences.
 *
 * Add a new preference by adding one line to PREFS — the storage key,
 * default value, and TypeScript type are all derived from that single
 * declaration. No other code should touch localStorage directly.
 */

const PREFIX = "myelin:";

/* ── Single-source pref declarations ─────────────────────── */

function pref<T>(storageKey: string, defaultValue: T) {
    return { storageKey: PREFIX + storageKey, defaultValue };
}

const PREFS = {
    keybindings:  pref<Record<string, import("@/lib/keybindings").KeyCombo>>("keybindings", {}),
    wheelTools:   pref<number[]>("wheel-tools", []),
    toolOptions:  pref<Record<string, Record<string, unknown>>>("tool-options", {}),
};

/* ── Derived types ───────────────────────────────────────── */

type PrefKey = keyof typeof PREFS;
type PrefValue<K extends PrefKey> = (typeof PREFS)[K]["defaultValue"];

/* ── Listeners ───────────────────────────────────────────── */

type Listener<K extends PrefKey> = (value: PrefValue<K>) => void;
const listeners = new Map<PrefKey, Set<Listener<never>>>();

/* ── Core API ────────────────────────────────────────────── */

export const UserPrefs = {
    get<K extends PrefKey>(key: K): PrefValue<K> {
        const { storageKey, defaultValue } = PREFS[key];
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw !== null) return JSON.parse(raw);
        } catch { /* corrupt data — fall through to default */ }
        return structuredClone(defaultValue) as PrefValue<K>;
    },

    set<K extends PrefKey>(key: K, value: PrefValue<K>): void {
        localStorage.setItem(PREFS[key].storageKey, JSON.stringify(value));
        const subs = listeners.get(key);
        if (subs) for (const fn of subs) (fn as Listener<K>)(value);
    },

    update<K extends PrefKey>(
        key: K,
        updater: (current: PrefValue<K>) => PrefValue<K>,
    ): void {
        this.set(key, updater(this.get(key)));
    },

    subscribe<K extends PrefKey>(key: K, fn: Listener<K>): () => void {
        let subs = listeners.get(key);
        if (!subs) {
            subs = new Set();
            listeners.set(key, subs);
        }
        subs.add(fn as Listener<never>);
        return () => { subs!.delete(fn as Listener<never>); };
    },

    remove<K extends PrefKey>(key: K): void {
        localStorage.removeItem(PREFS[key].storageKey);
        const subs = listeners.get(key);
        if (subs) {
            const def = structuredClone(PREFS[key].defaultValue) as PrefValue<K>;
            for (const fn of subs) (fn as Listener<K>)(def);
        }
    },
} as const;
