import { fetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_ID_ANDROID,
  GOOGLE_CLIENT_ID_IOS,
  MOBILE_PLATFORM,
} from '@/lib/env';
import { Logger } from '@/lib/logger';
import { createCredentialVault } from './credential-vault';
import {
  deriveCodeChallenge,
  encodeFormBody,
  raceAbort,
  randomUrlSafeToken,
} from './oauth/pkce';
import {
  MOBILE_REDIRECT_SCHEME,
  type OAuthRedirectListener,
  startOAuthRedirectListener,
} from './oauth/redirect';

const logger = new Logger('GoogleDriveCredentials');

export const GOOGLE_DRIVE_PROVIDER_NAME = 'Google Drive';

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
/** Refresh this far before nominal expiry so an in-flight request never races it. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * Google's iOS and Android OAuth client types reject the loopback redirect the
 * desktop flow uses, so mobile comes back through the app's custom URI scheme
 * instead, in the single-slash form Google documents for native clients.
 */
const MOBILE_REDIRECT_URI = `${MOBILE_REDIRECT_SCHEME}:/oauth2redirect`;

// Google issues a separate client per platform, and each only accepts the
// redirect style of its own type.
const CLIENT_IDS = {
  ios: { value: GOOGLE_CLIENT_ID_IOS, envVar: 'VITE_GOOGLE_CLIENT_ID_IOS' },
  android: {
    value: GOOGLE_CLIENT_ID_ANDROID,
    envVar: 'VITE_GOOGLE_CLIENT_ID_ANDROID',
  },
  desktop: { value: GOOGLE_CLIENT_ID, envVar: 'VITE_GOOGLE_CLIENT_ID' },
} as const;

interface StoredGoogleDriveToken {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
}

function getGoogleClientId(): string {
  const { value, envVar } = CLIENT_IDS[MOBILE_PLATFORM ?? 'desktop'];
  if (!value) {
    throw new Error(`${envVar} is not configured.`);
  }
  return value;
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
  description?: string | null,
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

interface PendingOAuthSession {
  codeVerifier: string;
  state: string;
  listener: OAuthRedirectListener;
}

const pendingOAuthSessions = new Map<string, PendingOAuthSession>();

export interface GoogleDriveOAuthStartPayload {
  credentialId: string;
  authorizeUrl: string;
}

export type GoogleDriveOAuthResult =
  | { status: 'complete'; credentialId: string }
  | { status: 'failed'; error: string };

/**
 * Starts the authorization code flow with PKCE. The redirect listener is opened
 * before the URL is handed back so the callback cannot land before anything is
 * ready to catch it; the caller must follow up with `waitForGoogleDriveAuth` or
 * `cancelGoogleDriveAuth` so the listener is torn down either way.
 *
 * No client secret is sent: `code_verifier` replaces it, which is what lets
 * these client ids ship in a public repository.
 */
export async function beginGoogleDriveAuth(
  credentialId: string,
): Promise<GoogleDriveOAuthStartPayload> {
  const normalized = normalizeCredentialId(credentialId);
  const clientId = getGoogleClientId();

  await cancelGoogleDriveAuth(normalized);

  const codeVerifier = randomUrlSafeToken();
  const state = randomUrlSafeToken();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);

  const listener = await startOAuthRedirectListener({
    provider: GOOGLE_DRIVE_PROVIDER_NAME,
    mobileRedirectUri: MOBILE_REDIRECT_URI,
  });
  pendingOAuthSessions.set(normalized, { codeVerifier, state, listener });

  const query = encodeFormBody({
    client_id: clientId,
    redirect_uri: listener.redirectUri,
    response_type: 'code',
    scope: GOOGLE_DRIVE_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Both are needed to reliably receive a refresh token.
    access_type: 'offline',
    prompt: 'consent',
  });

  return {
    credentialId: normalized,
    authorizeUrl: `${GOOGLE_AUTHORIZE_URL}?${query}`,
  };
}

export async function openGoogleDriveAuth(
  payload: GoogleDriveOAuthStartPayload,
): Promise<void> {
  await openUrl(payload.authorizeUrl);
}

export async function waitForGoogleDriveAuth(
  credentialId: string,
  options?: { signal?: AbortSignal },
): Promise<GoogleDriveOAuthResult> {
  const normalized = normalizeCredentialId(credentialId);
  const session = pendingOAuthSessions.get(normalized);
  if (!session) {
    throw new Error('No active Google Drive authorization session.');
  }

  try {
    const params = await raceAbort(
      session.listener.wait(),
      options?.signal,
      'Google Drive authorization wait aborted.',
    );

    if (params.error) {
      return {
        status: 'failed',
        error: tokenErrorMessage(
          'authorization',
          params.error,
          params.errorDescription,
        ),
      };
    }

    // A mismatched state means the redirect did not originate from the request
    // this app made, so the code that came with it is not ours to redeem.
    if (params.state !== session.state) {
      return {
        status: 'failed',
        error:
          'Google Drive authorization state did not match. Start sign-in again.',
      };
    }

    if (!params.code) {
      return {
        status: 'failed',
        error: 'Google Drive authorization returned no code.',
      };
    }

    const { payload, error } = await postTokenRequest({
      client_id: getGoogleClientId(),
      code: params.code,
      code_verifier: session.codeVerifier,
      redirect_uri: session.listener.redirectUri,
      grant_type: 'authorization_code',
    });

    if (error) {
      return {
        status: 'failed',
        error: tokenErrorMessage(
          'token exchange',
          error,
          payload.error_description,
        ),
      };
    }

    if (!payload.refresh_token) {
      return {
        status: 'failed',
        error:
          'Google token exchange returned no refresh token. Revoke Myelin Notes access in your Google account and sign in again.',
      };
    }

    await writeStoredToken(
      normalized,
      toStoredToken(payload, payload.refresh_token),
    );
    return { status: 'complete', credentialId: normalized };
  } finally {
    await cancelGoogleDriveAuth(normalized);
  }
}

export async function cancelGoogleDriveAuth(
  credentialId: string,
): Promise<void> {
  const normalized = normalizeCredentialId(credentialId);
  const session = pendingOAuthSessions.get(normalized);
  if (!session) {
    return;
  }

  pendingOAuthSessions.delete(normalized);
  await session.listener.cancel().catch((error) => {
    logger.warn('Failed to close Google Drive OAuth redirect listener', error);
  });
}
