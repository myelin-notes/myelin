import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { fetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { GOOGLE_CLIENT_ID } from '@/lib/env';
import { Logger } from '@/lib/logger';
import { createCredentialVault } from './credential-vault';

const logger = new Logger('GoogleDriveCredentials');

const vault = createCredentialVault({
  filename: 'google-drive-credentials.hold',
  clientName: 'google-drive',
  passwordPref: 'googleDriveVaultPassword',
});

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/**
 * Not a restricted scope, so shipping it needs no CASA security assessment. It
 * grants access only to files this app created, which is exactly the
 * app-created-folder model the Drive backend uses.
 */
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const REDIRECT_EVENT = 'oauth-loopback-redirect';
/** Refresh this far before nominal expiry so an in-flight request never races it. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

interface StoredGoogleDriveToken {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
}

function getGoogleClientId(): string {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('VITE_GOOGLE_CLIENT_ID is not configured.');
  }
  return GOOGLE_CLIENT_ID;
}

function normalizeCredentialId(credentialId?: string | null): string {
  const trimmed = typeof credentialId === 'string' ? credentialId.trim() : '';
  return trimmed || 'default';
}

function getTokenKey(credentialId: string): string {
  return `token:${normalizeCredentialId(credentialId)}`;
}

export function consumeGoogleDriveVaultDiscarded(): boolean {
  return vault.consumeDiscarded();
}

async function readStoredToken(
  credentialId: string,
): Promise<StoredGoogleDriveToken | null> {
  const raw = await vault.read(getTokenKey(credentialId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredGoogleDriveToken>;
    if (!parsed.refreshToken) {
      return null;
    }
    return {
      accessToken: parsed.accessToken ?? '',
      refreshToken: parsed.refreshToken,
      expiresAtMs: parsed.expiresAtMs ?? 0,
    };
  } catch {
    return null;
  }
}

async function writeStoredToken(
  credentialId: string,
  token: StoredGoogleDriveToken,
): Promise<void> {
  await vault.write(getTokenKey(credentialId), JSON.stringify(token));
}

export async function clearGoogleDriveToken(
  credentialId: string,
): Promise<void> {
  await vault.remove(getTokenKey(credentialId));
}

export async function hasGoogleDriveToken(
  credentialId: string,
): Promise<boolean> {
  return Boolean(await readStoredToken(credentialId));
}

export async function isGoogleDriveSecureStorageAvailable(): Promise<boolean> {
  return vault.isAvailable();
}

export async function isGoogleDriveAuthAvailable(): Promise<boolean> {
  try {
    getGoogleClientId();
  } catch {
    return false;
  }

  return isGoogleDriveSecureStorageAvailable();
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

function randomBase64Url(byteLength: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

function encodeFormBody(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Google's OAuth endpoints report failures as 4xx with the detail in a JSON
 * body, so a non-2xx status is parsed rather than treated as a transport
 * failure. Returns the parsed body along with the error code, if any.
 */
async function postTokenRequest(
  entries: Record<string, string>,
): Promise<{ payload: GoogleTokenResponse; error: string | null }> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeFormBody(entries),
  });

  const text = await response.text().catch(() => '');
  let payload: GoogleTokenResponse = {};
  try {
    payload = text ? (JSON.parse(text) as GoogleTokenResponse) : {};
  } catch {
    throw new Error(
      `Google token request returned an unreadable response (${response.status}): ${text}`,
    );
  }

  if (payload.error) {
    return { payload, error: payload.error };
  }
  if (!response.ok) {
    return { payload, error: `http_${response.status}` };
  }
  return { payload, error: null };
}

function tokenErrorMessage(
  action: string,
  error: string,
  description?: string,
): string {
  const detail = (description ?? '').trim();
  return detail
    ? `Google ${action} failed: ${error} (${detail})`
    : `Google ${action} failed: ${error}`;
}

function toStoredToken(
  payload: GoogleTokenResponse,
  refreshToken: string,
): StoredGoogleDriveToken {
  return {
    accessToken: payload.access_token ?? '',
    refreshToken,
    expiresAtMs: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
}

// One refresh in flight per credential: a page of Drive calls can find the
// token expired at the same moment, and Google invalidates the previous access
// token on each refresh.
const pendingRefreshes = new Map<string, Promise<string>>();

async function refreshAccessToken(
  credentialId: string,
  stored: StoredGoogleDriveToken,
): Promise<string> {
  const { payload, error } = await postTokenRequest({
    client_id: getGoogleClientId(),
    refresh_token: stored.refreshToken,
    grant_type: 'refresh_token',
  });

  if (error === 'invalid_grant') {
    // The grant was revoked or expired; the stored refresh token is dead, so
    // drop it and make the UI show a disconnected account rather than retrying.
    logger.warn('Google Drive refresh token rejected; clearing credential');
    await clearGoogleDriveToken(credentialId);
    throw new Error(
      'Google Drive access expired. Sign in again from Settings.',
    );
  }
  if (error) {
    throw new Error(
      tokenErrorMessage('token refresh', error, payload.error_description),
    );
  }
  if (!payload.access_token) {
    throw new Error('Google token refresh returned no access token.');
  }

  // A refresh response usually omits refresh_token; keep the one we hold.
  const next = toStoredToken(
    payload,
    payload.refresh_token ?? stored.refreshToken,
  );
  await writeStoredToken(credentialId, next);
  return next.accessToken;
}

export async function getGoogleDriveToken(
  credentialId: string,
): Promise<string> {
  const normalized = normalizeCredentialId(credentialId);
  const stored = await readStoredToken(normalized);
  if (!stored) {
    throw new Error('Google Drive account is not connected.');
  }

  if (
    stored.accessToken &&
    stored.expiresAtMs - TOKEN_EXPIRY_SKEW_MS > Date.now()
  ) {
    return stored.accessToken;
  }

  const existing = pendingRefreshes.get(normalized);
  if (existing) {
    return existing;
  }

  const refresh = refreshAccessToken(normalized, stored).finally(() => {
    pendingRefreshes.delete(normalized);
  });
  pendingRefreshes.set(normalized, refresh);
  return refresh;
}

/** Waits for the loopback listener to report the redirect's query string. */
function waitForRedirect(signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let unlisten: (() => void) | null = null;
    let settled = false;

    const finish = (run: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      unlisten?.();
      run();
    };

    const onAbort = () => {
      finish(() => reject(new Error('Google Drive sign-in was cancelled.')));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort);

    listen<string>(REDIRECT_EVENT, (event) => {
      finish(() => resolve(event.payload));
    }).then(
      (dispose) => {
        if (settled) {
          dispose();
        } else {
          unlisten = dispose;
        }
      },
      (error) => finish(() => reject(error)),
    );
  });
}

export async function cancelGoogleDriveAuth(): Promise<void> {
  await invoke('oauth_loopback_cancel');
}

/**
 * Runs the authorization code flow with PKCE and stores the resulting refresh
 * token. No client secret is sent: `code_verifier` replaces it, which is what
 * lets this client id ship in a public repository.
 */
export async function startGoogleDriveAuth(
  credentialId: string,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const normalized = normalizeCredentialId(credentialId);
  const clientId = getGoogleClientId();

  // The port is part of redirect_uri, so bind before building the authorize URL.
  const port = await invoke<number>('oauth_loopback_start');
  const redirectUri = `http://127.0.0.1:${port}`;
  const verifier = randomBase64Url(32);
  const state = randomBase64Url(16);

  try {
    const authorizeUrl = `${GOOGLE_AUTHORIZE_URL}?${encodeFormBody({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_DRIVE_SCOPE,
      code_challenge: await deriveCodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      // Both are needed to reliably receive a refresh token.
      access_type: 'offline',
      prompt: 'consent',
    })}`;

    const redirect = waitForRedirect(options.signal);
    await openUrl(authorizeUrl);
    const params = new URLSearchParams(await redirect);

    const authError = params.get('error');
    if (authError) {
      throw new Error(
        tokenErrorMessage(
          'authorization',
          authError,
          params.get('error_description') ?? undefined,
        ),
      );
    }
    if (params.get('state') !== state) {
      throw new Error('Google authorization returned an unexpected state.');
    }
    const code = params.get('code');
    if (!code) {
      throw new Error('Google authorization returned no code.');
    }

    const { payload, error } = await postTokenRequest({
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    if (error) {
      throw new Error(
        tokenErrorMessage('token exchange', error, payload.error_description),
      );
    }
    if (!payload.refresh_token) {
      throw new Error(
        'Google token exchange returned no refresh token. Revoke Myelin Notes access in your Google account and sign in again.',
      );
    }

    await writeStoredToken(
      normalized,
      toStoredToken(payload, payload.refresh_token),
    );
  } finally {
    await cancelGoogleDriveAuth().catch(() => {
      // best-effort teardown of the loopback listener
    });
  }
}
