import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { createCredentialVault } from './credential-vault';

interface FakeSnapshot {
  password: string;
  clients: Map<string, Map<string, number[]>>;
}

const snapshots = vi.hoisted(() => new Map<string, FakeSnapshot>());
const loadFailure = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  mkdir: async () => {},
  remove: async (path: string) => {
    snapshots.delete(path);
  },
}));

vi.mock('@tauri-apps/plugin-stronghold', () => {
  function createStore(records: Map<string, number[]>) {
    return {
      async get(key: string) {
        const value = records.get(key);
        return value ? Uint8Array.from(value) : null;
      },
      async insert(key: string, bytes: number[]) {
        records.set(key, bytes);
      },
      async remove(key: string) {
        records.delete(key);
      },
    };
  }

  class FakeStronghold {
    constructor(private readonly path: string) {}

    static async load(path: string, password: string) {
      if (loadFailure.error) {
        throw loadFailure.error;
      }
      const existing = snapshots.get(path);
      if (existing && existing.password !== password) {
        throw new Error('failed to read snapshot: BadFileKey');
      }
      if (!existing) {
        snapshots.set(path, { password, clients: new Map() });
      }
      return new FakeStronghold(path);
    }

    private snapshot(): FakeSnapshot {
      const snapshot = snapshots.get(this.path);
      if (!snapshot) {
        throw new Error(`No snapshot at ${this.path}`);
      }
      return snapshot;
    }

    async loadClient(name: string) {
      const records = this.snapshot().clients.get(name);
      if (!records) {
        throw new Error(`No client named ${name}`);
      }
      return { getStore: () => createStore(records) };
    }

    async createClient(name: string) {
      const records = new Map<string, number[]>();
      this.snapshot().clients.set(name, records);
      return { getStore: () => createStore(records) };
    }

    async save() {}
  }

  return { Stronghold: FakeStronghold };
});

const OPTIONS = {
  filename: 'test-credentials.hold',
  clientName: 'test',
  passwordPref: 'githubVaultPassword',
} as const;

describe('createCredentialVault', () => {
  beforeEach(() => {
    snapshots.clear();
    loadFailure.error = null;
  });

  it('round-trips a secret and forgets it on remove', async () => {
    const vault = createCredentialVault(OPTIONS);

    await vault.write('token:default', 'secret-value');

    expect(await vault.read('token:default')).toBe('secret-value');
    expect(await vault.read('token:other')).toBeNull();

    await vault.remove('token:default');
    expect(await vault.read('token:default')).toBeNull();
  });

  it('generates the vault password once and reuses it', async () => {
    await createCredentialVault(OPTIONS).write('token:default', 'secret-value');
    const password = UserPrefs.get('githubVaultPassword');
    expect(password).toHaveLength(64);

    // A separate vault instance is what a later app launch sees.
    const reopened = createCredentialVault(OPTIONS);
    expect(await reopened.read('token:default')).toBe('secret-value');
    expect(UserPrefs.get('githubVaultPassword')).toBe(password);
  });

  it('discards a vault it can no longer decrypt and reports it once', async () => {
    await createCredentialVault(OPTIONS).write('token:default', 'secret-value');
    UserPrefs.set('githubVaultPassword', 'a-different-password');

    const vault = createCredentialVault(OPTIONS);
    expect(await vault.read('token:default')).toBeNull();
    expect(vault.consumeDiscarded()).toBe(true);
    expect(vault.consumeDiscarded()).toBe(false);

    // The fresh vault is usable, so the user only has to re-authenticate.
    await vault.write('token:default', 'reconnected');
    expect(await vault.read('token:default')).toBe('reconnected');
  });

  it('reports storage as unavailable when the vault cannot be opened', async () => {
    loadFailure.error = new Error('stronghold plugin is missing');
    const vault = createCredentialVault(OPTIONS);

    expect(await vault.isAvailable()).toBe(false);
    await expect(vault.read('token:default')).rejects.toThrow(
      /Encrypted credential storage is unavailable/,
    );

    // The failed load is not cached, so the vault recovers once it can open.
    loadFailure.error = null;
    expect(await vault.isAvailable()).toBe(true);
  });
});
