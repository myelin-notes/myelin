import { Logger } from '@myelin/shared/logger';
import { fetch } from '@tauri-apps/plugin-http';
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_ID_ANDROID,
  GOOGLE_CLIENT_ID_IOS,
  GOOGLE_CLIENT_SECRET,
  MOBILE_PLATFORM,
} from '@/lib/env';
import { createCredentialVault } from './credential-vault';
import {
  credentialTokenKey,
  normalizeCredentialId,
  OAuthClient,
  type OAuthExchange,
  type OAuthResult,
  type OAuthStartPayload,
} from './oauth/client';
import { encodeFormBody } from './oauth/pkce';
import { MOBILE_REDIRECT_SCHEME } from './oauth/redirect';

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
// redirect style of its own type. Only the Desktop client has a secret: iOS and
// Android clients are true public clients and Google issues none for them.
const CLIENTS = {
  ios: {
    id: GOOGLE_CLIENT_ID_IOS,
    idEnvVar: 'VITE_GOOGLE_CLIENT_ID_IOS',
    secret: null,
    secretEnvVar: null,
  },
  android: {
    id: GOOGLE_CLIENT_ID_ANDROID,
    idEnvVar: 'VITE_GOOGLE_CLIENT_ID_ANDROID',
    secret: null,
    secretEnvVar: null,
  },
  desktop: {
    id: GOOGLE_CLIENT_ID,
    idEnvVar: 'VITE_GOOGLE_CLIENT_ID',
    secret: GOOGLE_CLIENT_SECRET,
    secretEnvVar: 'VITE_GOOGLE_CLIENT_SECRET',
  },
} as const;

interface StoredGoogleDriveToken {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
}

/**
 * Client id, plus the secret when the platform's client type has one. Google
 * rejects the token exchange with `invalid_request` if a Desktop client omits
 * its secret, even though PKCE is in play and the docs call the parameter
 * optional, so it is validated up front alongside the id.
 */
function getGoogleClientCredentials(): {
  clientId: string;
  clientSecret: string | null;
} {
  const client = CLIENTS[MOBILE_PLATFORM ?? 'desktop'];
  if (!client.id) {
    throw new Error(`${client.idEnvVar} is not configured.`);
  }
  if (client.secretEnvVar && !client.secret) {
    throw new Error(`${client.secretEnvVar} is not configured.`);
  }
  return { clientId: client.id, clientSecret: client.secret ?? null };
}

function clientCredentialEntries(): Record<string, string> {
  const { clientId, clientSecret } = getGoogleClientCredentials();
  return {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  };
}

export function consumeGoogleDriveVaultDiscarded(): boolean {
  return vault.consumeDiscarded();
}

async function readStoredToken(
  credentialId: string,
): Promise<StoredGoogleDriveToken | null> {
  const raw = await vault.read(credentialTokenKey(credentialId));
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
  await vault.write(credentialTokenKey(credentialId), JSON.stringify(token));
}

export async function clearGoogleDriveToken(
  credentialId: string,
): Promise<void> {
  await vault.remove(credentialTokenKey(credentialId));
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
    getGoogleClientCredentials();
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
    ...clientCredentialEntries(),
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

export type GoogleDriveOAuthStartPayload = OAuthStartPayload;
export type GoogleDriveOAuthResult = OAuthResult;

async function exchangeGoogleDriveCode({
  credentialId,
  code,
  codeVerifier,
  redirectUri,
}: OAuthExchange): Promise<OAuthResult> {
  const { payload, error } = await postTokenRequest({
    ...clientCredentialEntries(),
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
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
    credentialId,
    toStoredToken(payload, payload.refresh_token),
  );
  return { status: 'complete', credentialId };
}

const oauth = new OAuthClient({
  provider: GOOGLE_DRIVE_PROVIDER_NAME,
  authorizeUrl: GOOGLE_AUTHORIZE_URL,
  scope: GOOGLE_DRIVE_SCOPE,
  mobileRedirectUri: MOBILE_REDIRECT_URI,
  resolveClientId: () => getGoogleClientCredentials().clientId,
  authorizeParams: {
    response_type: 'code',
    // Both are needed to reliably receive a refresh token.
    access_type: 'offline',
    prompt: 'consent',
  },
  exchange: exchangeGoogleDriveCode,
});

export function beginGoogleDriveAuth(
  credentialId: string,
): Promise<GoogleDriveOAuthStartPayload> {
  return oauth.begin(credentialId);
}

export function openGoogleDriveAuth(
  payload: GoogleDriveOAuthStartPayload,
): Promise<void> {
  return oauth.open(payload);
}

export function waitForGoogleDriveAuth(
  credentialId: string,
  options?: { signal?: AbortSignal },
): Promise<GoogleDriveOAuthResult> {
  return oauth.wait(credentialId, options);
}

export function cancelGoogleDriveAuth(credentialId: string): Promise<void> {
  return oauth.cancel(credentialId);
}
