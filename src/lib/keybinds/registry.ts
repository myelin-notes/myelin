import { UserPrefs } from '@/lib/user-prefs';

// biome-ignore lint/suspicious/noEmptyInterface: intentionally empty, extended via declaration merging
export interface ActionMap {}
export type Action = [keyof ActionMap] extends [never]
  ? string
  : keyof ActionMap & string;

export interface KeyCombo {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export function comboMatches(e: KeyboardEvent, combo: KeyCombo): boolean {
  if (e.key.toLowerCase() !== combo.key.toLowerCase()) {
    return false;
  }
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!!combo.mod !== mod) {
    return false;
  }
  if (!!combo.shift !== e.shiftKey) {
    return false;
  }
  if (!!combo.alt !== e.altKey) {
    return false;
  }
  return true;
}

export function formatKeyCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.mod) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (combo.shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }
  if (combo.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }
  const key =
    combo.key === ' '
      ? 'Space'
      : combo.key.length === 1
        ? combo.key.toUpperCase()
        : combo.key;
  parts.push(key);
  return isMac ? parts.join(' ') : parts.join('+');
}

/** Convert a KeyCombo to a ProseMirror keymap string (e.g., "Mod-b"). */
export function comboToPMKey(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.mod) {
    parts.push('Mod');
  }
  if (combo.shift) {
    parts.push('Shift');
  }
  if (combo.alt) {
    parts.push('Alt');
  }
  parts.push(combo.key);
  return parts.join('-');
}

export class KeybindingRegistry {
  private defaults = new Map<string, KeyCombo>();
  private overrides = new Map<string, KeyCombo>();
  private locked = new Set<string>();

  constructor() {
    this.loadOverrides();
  }

  defineDefaults(
    defaults: Partial<Record<Action, KeyCombo>>,
    options?: { locked?: boolean },
  ) {
    for (const [action, combo] of Object.entries(defaults)) {
      if (combo) {
        this.defaults.set(action, combo);
        if (options?.locked) {
          this.locked.add(action);
        }
      }
    }
  }

  getCombo(action: Action): KeyCombo | undefined {
    return this.overrides.get(action) ?? this.defaults.get(action);
  }

  getDefault(action: Action): KeyCombo | undefined {
    return this.defaults.get(action);
  }

  isRebound(action: Action): boolean {
    return this.overrides.has(action);
  }

  format(action: Action): string {
    const combo = this.getCombo(action);
    return combo ? formatKeyCombo(combo) : '';
  }

  rebind(action: Action, combo: KeyCombo) {
    if (this.locked.has(action)) return;
    this.overrides.set(action, combo);
    this.saveOverrides();
  }

  resetBinding(action: Action) {
    this.overrides.delete(action);
    this.saveOverrides();
  }

  resetAll() {
    this.overrides.clear();
    this.saveOverrides();
  }

  get actions(): Action[] {
    return [...this.defaults.keys()].filter(
      (a) => !this.locked.has(a),
    ) as Action[];
  }

  private loadOverrides() {
    const saved = UserPrefs.get('keybindings');
    for (const [action, combo] of Object.entries(saved)) {
      this.overrides.set(action, combo);
    }
  }

  private saveOverrides() {
    const obj: Record<string, KeyCombo> = {};
    for (const [action, combo] of this.overrides) {
      obj[action] = combo;
    }
    UserPrefs.set('keybindings', obj);
  }
}
