import { UserPrefs } from '@myelin/editor/user-prefs';
import { Logger } from '@myelin/shared/logger';
import { join } from '@tauri-apps/api/path';
import { remove } from '@tauri-apps/plugin-fs';
import {
  Stronghold,
  type Client as StrongholdClient,
  type Store as StrongholdStore,
} from '@tauri-apps/plugin-stronghold';
import { getAppDataDir } from '@/platform/tauri/fs-cache';

const logger = new Logger('CredentialVault');

const SECURE_STORAGE_UNAVAILABLE_ERROR =
  'Encrypted credential storage is unavailable on this device.';

export interface CredentialVaultOptions {
  /** Stronghold snapshot file, created under the app data directory. */
  filename: string;
  /** Stronghold client name namespacing this provider's records. */
  clientName: string;
  /** UserPrefs key holding the generated vault password. */
  passwordPref: 'githubVaultPassword' | 'googleDriveVaultPassword';
}

export interface CredentialVault {
  /** Whether the vault can be opened at all on this device. */
  isAvailable(): Promise<boolean>;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** True once if a stale, undecryptable vault was discarded, so the UI can show a one-time notice. */
  consumeDiscarded(): boolean;
}

function generateVaultPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function isVaultKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('BadFileKey') || message.includes('decode/decrypt');
}

function storageUnavailableError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${SECURE_STORAGE_UNAVAILABLE_ERROR} ${message}`.trim());
}

export function createCredentialVault(
  options: CredentialVaultOptions,
): CredentialVault {
  let discarded = false;
  let storePromise: Promise<{
    stronghold: Stronghold;
    store: StrongholdStore;
  }> | null = null;

  function getPassword(): string {
    const existing = UserPrefs.get(options.passwordPref).trim();
    if (existing) {
      return existing;
    }

    const generated = generateVaultPassword();
    UserPrefs.set(options.passwordPref, generated);
    return generated;
  }

  async function loadStronghold(
    vaultPath: string,
    password: string,
  ): Promise<Stronghold> {
    try {
      return await Stronghold.load(vaultPath, password);
    } catch (error) {
      if (!isVaultKeyError(error)) {
        throw error;
      }

      // The vault exists but can't be decrypted with the current password (e.g. it was regenerated).
      // Any token inside is unrecoverable, so discard and start fresh — the user re-authenticates.
      // A warning, not an exception, since this is expected and self-healing.
      logger.warn(`Discarding unreadable ${options.clientName} vault`, error);
      discarded = true;
      await remove(vaultPath).catch((removeError) => {
        logger.warn(
          `Failed to remove unreadable ${options.clientName} vault`,
          removeError,
        );
      });
      return Stronghold.load(vaultPath, password);
    }
  }

  async function createStore(): Promise<{
    stronghold: Stronghold;
    store: StrongholdStore;
  }> {
    const vaultPath = await join(await getAppDataDir(), options.filename);
    const stronghold = await loadStronghold(vaultPath, getPassword());

    let client: StrongholdClient;
    try {
      client = await stronghold.loadClient(options.clientName);
    } catch {
      client = await stronghold.createClient(options.clientName);
    }

    return { stronghold, store: client.getStore() };
  }

  function getStore(): Promise<{
    stronghold: Stronghold;
    store: StrongholdStore;
  }> {
    if (!storePromise) {
      storePromise = createStore().catch((error) => {
        storePromise = null;
        throw error;
      });
    }
    return storePromise;
  }

  async function withStore<T>(
    run: (store: StrongholdStore, stronghold: Stronghold) => Promise<T>,
  ): Promise<T> {
    try {
      const { store, stronghold } = await getStore();
      return await run(store, stronghold);
    } catch (error) {
      throw storageUnavailableError(error);
    }
  }

  return {
    async isAvailable() {
      try {
        await getStore();
        return true;
      } catch {
        return false;
      }
    },
    read(key) {
      return withStore(async (store) => {
        const bytes = await store.get(key);
        if (!bytes || bytes.byteLength === 0) {
          return null;
        }
        return new TextDecoder().decode(bytes).trim() || null;
      });
    },
    async write(key, value) {
      await withStore(async (store, stronghold) => {
        const bytes = Array.from(new TextEncoder().encode(value));
        await store.insert(key, bytes);
        await stronghold.save();
      });
    },
    async remove(key) {
      await withStore(async (store, stronghold) => {
        await store.remove(key);
        await stronghold.save();
      });
    },
    consumeDiscarded() {
      const value = discarded;
      discarded = false;
      return value;
    },
  };
}
