import { join } from '@tauri-apps/api/path';
import { remove } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Stronghold,
  type Client as StrongholdClient,
  type Store as StrongholdStore,
} from '@tauri-apps/plugin-stronghold';
import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from '@/lib/env';
import { Logger } from '@/lib/logger';
import { UserPrefs } from '@/lib/user-prefs';
import { getAppDataDir } from '@/platform/tauri/fs-cache';
import {
  type OAuthRedirectListener,
  startOAuthRedirectListener,
} from './github-oauth-redirect';

const logger = new Logger('GitHubCredentials');

const SECURE_STORAGE_UNAVAILABLE_ERROR =
  'Encrypted credential storage is unavailable on this device.';
const GITHUB_STRONGHOLD_FILENAME = 'github-credentials.hold';
const GITHUB_STRONGHOLD_CLIENT = 'github';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_OAUTH_SCOPE = 'repo';

function getGitHubClientId(): string {
  if (!GITHUB_CLIENT_ID) {
    throw new Error('VITE_GITHUB_CLIENT_ID is not configured.');
  }
  return GITHUB_CLIENT_ID;
}

// GitHub demands a client secret even on the PKCE flow, since it draws no
// distinction between public and confidential clients. See lib/env.ts.
function getGitHubClientSecret(): string {
  if (!GITHUB_CLIENT_SECRET) {
    throw new Error('VITE_GITHUB_CLIENT_SECRET is not configured.');
  }
  return GITHUB_CLIENT_SECRET;
}

function normalizeCredentialId(credentialId?: string | null): string {
  const trimmed = typeof credentialId === 'string' ? credentialId.trim() : '';
  return trimmed || 'default';
}

function getGitHubTokenKey(credentialId: string): string {
  return `token:${normalizeCredentialId(credentialId)}`;
}

function generateGitHubVaultPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function getGitHubVaultPassword(): string {
  const existing = UserPrefs.get('githubVaultPassword').trim();
  if (existing) {
    return existing;
  }

  const generated = generateGitHubVaultPassword();
  UserPrefs.set('githubVaultPassword', generated);
  return generated;
}

function isVaultKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('BadFileKey') || message.includes('decode/decrypt');
}

// Set when a stale, undecryptable vault is discarded so the UI can surface a
// one-time "sign-in expired, please reconnect" notice. Read-and-cleared via
// consumeGitHubVaultDiscarded().
let githubVaultDiscarded = false;

export function consumeGitHubVaultDiscarded(): boolean {
  const discarded = githubVaultDiscarded;
  githubVaultDiscarded = false;
  return discarded;
}

async function loadGitHubStronghold(
  vaultPath: string,
  password: string,
): Promise<Stronghold> {
  try {
    return await Stronghold.load(vaultPath, password);
  } catch (error) {
    if (!isVaultKeyError(error)) {
      throw error;
    }

    // The vault file exists but can't be decrypted with the current password
    // (e.g. the stored vault password was reset/regenerated). Any token inside
    // is unrecoverable, so discard the file and start fresh — the user simply
    // re-authenticates. Logged as a warning so it isn't reported as an
    // exception for an expected, self-healing condition.
    logger.warn('Discarding unreadable GitHub credential vault', error);
    githubVaultDiscarded = true;
    await remove(vaultPath).catch((removeError) => {
      logger.warn('Failed to remove unreadable GitHub vault', removeError);
    });
    return Stronghold.load(vaultPath, password);
  }
}

async function createGitHubStrongholdStore(): Promise<{
  stronghold: Stronghold;
  store: StrongholdStore;
}> {
  const vaultPath = await join(
    await getAppDataDir(),
    GITHUB_STRONGHOLD_FILENAME,
  );
  const stronghold = await loadGitHubStronghold(
    vaultPath,
    getGitHubVaultPassword(),
  );

  let client: StrongholdClient;
  try {
    client = await stronghold.loadClient(GITHUB_STRONGHOLD_CLIENT);
  } catch {
    client = await stronghold.createClient(GITHUB_STRONGHOLD_CLIENT);
  }

  return {
    stronghold,
    store: client.getStore(),
  };
}

let githubStorePromise: Promise<{
  stronghold: Stronghold;
  store: StrongholdStore;
}> | null = null;

async function getGitHubStrongholdStore(): Promise<{
  stronghold: Stronghold;
  store: StrongholdStore;
}> {
  if (!githubStorePromise) {
    githubStorePromise = createGitHubStrongholdStore().catch((error) => {
      githubStorePromise = null;
      throw error;
    });
  }

  return githubStorePromise;
}

function storageUnavailableError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${SECURE_STORAGE_UNAVAILABLE_ERROR} ${message}`.trim());
}

async function withGitHubStronghold<T>(
  run: (store: StrongholdStore, stronghold: Stronghold) => Promise<T>,
): Promise<T> {
  try {
    const { store, stronghold } = await getGitHubStrongholdStore();
    return await run(store, stronghold);
  } catch (error) {
    throw storageUnavailableError(error);
  }
}

function decodeGitHubToken(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.byteLength === 0) {
    return null;
  }

  const token = new TextDecoder().decode(bytes).trim();
  return token || null;
}

async function readGitHubToken(credentialId: string): Promise<string | null> {
  return withGitHubStronghold(async (store) => {
    const bytes = await store.get(getGitHubTokenKey(credentialId));
    return decodeGitHubToken(bytes);
  });
}

interface PendingOAuthSession {
  codeVerifier: string;
  state: string;
  listener: OAuthRedirectListener;
}

const pendingOAuthSessions = new Map<string, PendingOAuthSession>();

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export interface GitHubOAuthStartPayload {
  credentialId: string;
  authorizeUrl: string;
}

export type GitHubOAuthCompletePayload = {
  status: 'complete';
  credentialId: string;
};

export type GitHubOAuthFailedPayload = {
  status: 'failed';
  error: string;
};

export type GitHubOAuthResult =
  | GitHubOAuthCompletePayload
  | GitHubOAuthFailedPayload;

function encodeFormBody(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
}

async function postGitHubForm<T>(
  url: string,
  entries: Record<string, string>,
  label: string,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'myelin',
    },
    body: encodeFormBody(entries),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '<no response body>');
    throw new Error(`${label} (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomUrlSafeToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function deriveCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

function oauthFailureMessage(
  error: string,
  description: string | null | undefined,
): string {
  const trimmed = (description ?? '').trim();
  const detail = trimmed || 'GitHub authorization failed.';
  return `GitHub authorization failed: ${error} (${detail})`;
}

/**
 * Rejects as soon as `signal` aborts so a cancelled sign-in stops waiting on a
 * redirect that is never coming, rather than holding the listener open.
 */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const abort = () =>
        reject(new Error('GitHub authorization wait aborted.'));
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    }),
  ]);
}

export async function isGitHubSecureStorageAvailable(): Promise<boolean> {
  try {
    await getGitHubStrongholdStore();
    return true;
  } catch {
    return false;
  }
}

export async function getGitHubToken(credentialId: string): Promise<string> {
  const token = await readGitHubToken(credentialId);
  if (!token) {
    throw new Error('GitHub token is not configured.');
  }

  return token;
}

export async function hasGitHubToken(credentialId: string): Promise<boolean> {
  return Boolean(await readGitHubToken(credentialId));
}

export async function storeGitHubToken(
  credentialId: string,
  token: string,
): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('GitHub token cannot be empty.');
  }

  await withGitHubStronghold(async (store, stronghold) => {
    const bytes = Array.from(new TextEncoder().encode(trimmed));
    await store.insert(getGitHubTokenKey(credentialId), bytes);
    await stronghold.save();
  });
}

export async function clearGitHubToken(credentialId: string): Promise<void> {
  await withGitHubStronghold(async (store, stronghold) => {
    await store.remove(getGitHubTokenKey(credentialId));
    await stronghold.save();
  });
}

export async function isGitHubOAuthAvailable(): Promise<boolean> {
  try {
    getGitHubClientId();
    getGitHubClientSecret();
  } catch {
    return false;
  }

  return isGitHubSecureStorageAvailable();
}

/**
 * Starts the authorization code flow with PKCE. The redirect listener is opened
 * before the URL is handed back so the callback cannot land before anything is
 * ready to catch it; the caller must follow up with `waitForGitHubOAuth` or
 * `cancelGitHubOAuth` so the listener is torn down either way.
 */
export async function beginGitHubOAuth(
  credentialId: string,
): Promise<GitHubOAuthStartPayload> {
  const normalized = normalizeCredentialId(credentialId);
  const clientId = getGitHubClientId();
  // Checked up front: a missing secret only surfaces at token exchange
  // otherwise, after the user has already authorized in the browser.
  getGitHubClientSecret();

  await cancelGitHubOAuth(normalized);

  const codeVerifier = randomUrlSafeToken();
  const state = randomUrlSafeToken();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);

  const listener = await startOAuthRedirectListener();
  pendingOAuthSessions.set(normalized, { codeVerifier, state, listener });

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: listener.redirectUri,
    scope: GITHUB_OAUTH_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    credentialId: normalized,
    authorizeUrl: `${GITHUB_AUTHORIZE_URL}?${query.toString()}`,
  };
}

export async function openGitHubOAuth(
  payload: GitHubOAuthStartPayload,
): Promise<void> {
  await openUrl(payload.authorizeUrl);
}

export async function waitForGitHubOAuth(
  credentialId: string,
  options?: { signal?: AbortSignal },
): Promise<GitHubOAuthResult> {
  const normalized = normalizeCredentialId(credentialId);
  const session = pendingOAuthSessions.get(normalized);
  if (!session) {
    throw new Error('No active GitHub authorization session.');
  }

  try {
    const params = await raceAbort(session.listener.wait(), options?.signal);

    if (params.error) {
      return {
        status: 'failed',
        error: oauthFailureMessage(params.error, params.errorDescription),
      };
    }

    // A mismatched state means the redirect did not originate from the request
    // this app made, so the code that came with it is not ours to redeem.
    if (params.state !== session.state) {
      return {
        status: 'failed',
        error: 'GitHub authorization state did not match. Start sign-in again.',
      };
    }

    if (!params.code) {
      return {
        status: 'failed',
        error: 'GitHub authorization returned no code.',
      };
    }

    const response = await postGitHubForm<GitHubTokenResponse>(
      GITHUB_TOKEN_URL,
      {
        client_id: getGitHubClientId(),
        client_secret: getGitHubClientSecret(),
        code: params.code,
        code_verifier: session.codeVerifier,
        redirect_uri: session.listener.redirectUri,
      },
      'GitHub token exchange failed',
    );

    if (response.error) {
      return {
        status: 'failed',
        error: oauthFailureMessage(response.error, response.error_description),
      };
    }

    const token = response.access_token?.trim();
    if (!token) {
      return {
        status: 'failed',
        error: 'GitHub authorization returned an empty access token.',
      };
    }

    await storeGitHubToken(normalized, token);
    return { status: 'complete', credentialId: normalized };
  } finally {
    await cancelGitHubOAuth(normalized);
  }
}

export async function cancelGitHubOAuth(credentialId: string): Promise<void> {
  const normalized = normalizeCredentialId(credentialId);
  const session = pendingOAuthSessions.get(normalized);
  if (!session) {
    return;
  }

  pendingOAuthSessions.delete(normalized);
  await session.listener.cancel().catch((error) => {
    logger.warn('Failed to close GitHub OAuth redirect listener', error);
  });
}
