export interface ActionMap {}
export type Action = keyof ActionMap & string;

export interface KeyCombo {
    key: string;
    mod?: boolean;
    shift?: boolean;
    alt?: boolean;
}

export interface ActionBinding {
    action: Action;
    onDown?: (e: KeyboardEvent) => void;
    onUp?: (e: KeyboardEvent) => void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const STORAGE_KEY = "myelin:keybindings";

function comboMatches(e: KeyboardEvent, combo: KeyCombo): boolean {
    if (e.key.toLowerCase() !== combo.key.toLowerCase()) return false;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!!combo.mod !== mod) return false;
    if (!!combo.shift !== e.shiftKey) return false;
    if (!!combo.alt !== e.altKey) return false;
    return true;
}

export function formatKeyCombo(combo: KeyCombo): string {
    const parts: string[] = [];
    if (combo.mod) parts.push(isMac ? "⌘" : "Ctrl");
    if (combo.shift) parts.push(isMac ? "⇧" : "Shift");
    if (combo.alt) parts.push(isMac ? "⌥" : "Alt");
    const key = combo.key === " " ? "Space"
        : combo.key.length === 1 ? combo.key.toUpperCase()
        : combo.key;
    parts.push(key);
    return isMac ? parts.join("") : parts.join("+");
}

class KeybindingManager {
    private defaults = new Map<string, KeyCombo>();
    private overrides = new Map<string, KeyCombo>();
    private bindings: ActionBinding[] = [];
    private listening = false;

    constructor() {
        this.loadOverrides();
    }

    defineDefaults(defaults: Partial<Record<Action, KeyCombo>>) {
        for (const [action, combo] of Object.entries(defaults)) {
            if (combo) this.defaults.set(action, combo);
        }
    }

    register(bindings: ActionBinding[]): () => void {
        this.bindings.push(...bindings);
        if (!this.listening) this.startListening();
        return () => {
            for (const b of bindings) {
                const i = this.bindings.indexOf(b);
                if (i >= 0) this.bindings.splice(i, 1);
            }
            if (this.bindings.length === 0) this.stopListening();
        };
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
        return combo ? formatKeyCombo(combo) : "";
    }

    rebind(action: Action, combo: KeyCombo) {
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
        return [...this.defaults.keys()] as Action[];
    }

    private loadOverrides() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            for (const [action, combo] of Object.entries(parsed)) {
                this.overrides.set(action, combo as KeyCombo);
            }
        } catch { /* ignore corrupt data */ }
    }

    private saveOverrides() {
        const obj: Record<string, KeyCombo> = {};
        for (const [action, combo] of this.overrides) obj[action] = combo;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    }

    private startListening() {
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("keyup", this.onKeyUp);
        this.listening = true;
    }

    private stopListening() {
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("keyup", this.onKeyUp);
        this.listening = false;
    }

    private shouldIgnore(e: KeyboardEvent): boolean {
        const tag = (e.target as HTMLElement)?.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable === true;
    }

    private onKeyDown = (e: KeyboardEvent) => {
        if (this.shouldIgnore(e)) return;
        for (const b of this.bindings) {
            const combo = this.getCombo(b.action);
            if (combo && comboMatches(e, combo)) b.onDown?.(e);
        }
    };

    private onKeyUp = (e: KeyboardEvent) => {
        if (this.shouldIgnore(e)) return;
        for (const b of this.bindings) {
            const combo = this.getCombo(b.action);
            if (combo && comboMatches(e, combo)) b.onUp?.(e);
        }
    };
}

export const keybindings = new KeybindingManager();
