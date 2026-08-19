import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthCallbackParams } from './oauth/redirect';

// The shared setup replaces this module wholesale for consumers that only need
// a token; here the real implementation is what's under test.
vi.unmock('@/lib/sync/repo/google-drive-credentials');

vi.mock('@/lib/env', () => ({
  IS_DEV: false,
  MODE: 'test',
  IS_MOBILE_BUILD: false,
  MOBILE_PLATFORM: null,
  GITHUB_CLIENT_ID: 'test-github-client-id',
  GITHUB_CLIENT_SECRET: 'test-github-client-secret',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_ID_IOS: '',
  GOOGLE_CLIENT_ID_ANDROID: '',
  LIVE_DISCOVERY_URL: 'https://live.test',
  POSTHOG_KEY: '',
  POSTHOG_HOST: '',
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => {}),
}));

const REDIRECT_URI = 'http://127.0.0.1:54321/oauth/callback';

let resolveRedirect: (params: OAuthCallbackParams) => void;
const cancelListener = vi.fn(async () => {});

vi.mock('./oauth/redirect', () => ({
  MOBILE_REDIRECT_SCHEME: 'com.github.wintersteve25.myelin',
  startOAuthRedirectListener: async () => ({
    redirectUri: REDIRECT_URI,
    wait: () =>
      new Promise<OAuthCallbackParams>((resolve) => {
        resolveRedirect = resolve;
      }),
    cancel: cancelListener,
  }),
}));

const storedSecrets = new Map<string, string>();

vi.mock('./credential-vault', () => ({
  createCredentialVault: () => ({
    isAvailable: async () => true,
    read: async (key: string) => storedSecrets.get(key) ?? null,
    write: async (key: string, value: string) => {
      storedSecrets.set(key, value);
    },
    remove: async (key: string) => {
      storedSecrets.delete(key);
    },
    consumeDiscarded: () => false,
  }),
}));

const tokenResponses: unknown[] = [];
const tokenRequests: Array<Record<string, string>> = [];

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(async (_url: string, init: { body: string }) => {
    tokenRequests.push(
      Object.fromEntries(new URLSearchParams(init.body)) as Record<
        string,
        string
      >,
    );
    const body = tokenResponses.shift() ?? {};
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    };
  }),
}));

const {
  beginGoogleDriveAuth,
  cancelGoogleDriveAuth,
  hasGoogleDriveToken,
  waitForGoogleDriveAuth,
} = await import('./google-drive-credentials');

async function base64UrlSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  let binary = '';
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('Google Drive OAuth', () => {
  beforeEach(() => {
    storedSecrets.clear();
    tokenResponses.length = 0;
    tokenRequests.length = 0;
    cancelListener.mockClear();
  });

  it('redeems the code with the verifier the challenge was derived from', async () => {
    const { authorizeUrl } = await beginGoogleDriveAuth('default');
    const query = new URL(authorizeUrl).searchParams;

    expect(query.get('client_id')).toBe('test-google-client-id');
    expect(query.get('response_type')).toBe('code');
    expect(query.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(query.get('scope')).toBe(
      'https://www.googleapis.com/auth/drive.file',
    );
    expect(query.get('code_challenge_method')).toBe('S256');
    // Without both, Google does not reliably return a refresh token.
    expect(query.get('access_type')).toBe('offline');
    expect(query.get('prompt')).toBe('consent');

    tokenResponses.push({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
    });

    const pending = waitForGoogleDriveAuth('default');
    resolveRedirect({
      code: 'auth-code',
      state: query.get('state'),
      error: null,
      errorDescription: null,
    });

    await expect(pending).resolves.toEqual({
      status: 'complete',
      credentialId: 'default',
    });

    const exchange = tokenRequests.at(-1);
    expect(exchange?.grant_type).toBe('authorization_code');
    expect(exchange?.code).toBe('auth-code');
    expect(exchange?.redirect_uri).toBe(REDIRECT_URI);
    // No client secret: PKCE is what proves this is the client that started it.
    expect(exchange?.client_secret).toBeUndefined();
    expect(await base64UrlSha256(exchange?.code_verifier ?? '')).toBe(
      query.get('code_challenge'),
    );

    expect(await hasGoogleDriveToken('default')).toBe(true);
    expect(cancelListener).toHaveBeenCalled();
  });

  it('refuses a redirect whose state does not match', async () => {
    await beginGoogleDriveAuth('default');

    const pending = waitForGoogleDriveAuth('default');
    resolveRedirect({
      code: 'auth-code',
      state: 'not-the-state-we-sent',
      error: null,
      errorDescription: null,
    });

    await expect(pending).resolves.toMatchObject({ status: 'failed' });
    expect(tokenRequests).toHaveLength(0);
    expect(await hasGoogleDriveToken('default')).toBe(false);
  });

  it('surfaces an authorization error without exchanging', async () => {
    await beginGoogleDriveAuth('default');

    const pending = waitForGoogleDriveAuth('default');
    resolveRedirect({
      code: null,
      state: null,
      error: 'access_denied',
      errorDescription: 'The user said no',
    });

    await expect(pending).resolves.toEqual({
      status: 'failed',
      error: 'Google authorization failed: access_denied (The user said no)',
    });
    expect(tokenRequests).toHaveLength(0);
  });

  it('rejects a token response with no refresh token', async () => {
    const { authorizeUrl } = await beginGoogleDriveAuth('default');
    const state = new URL(authorizeUrl).searchParams.get('state');

    // Google omits refresh_token when the user already granted consent and the
    // prior grant is still live; without it the account cannot be kept signed in.
    tokenResponses.push({ access_token: 'access-1', expires_in: 3600 });

    const pending = waitForGoogleDriveAuth('default');
    resolveRedirect({
      code: 'auth-code',
      state,
      error: null,
      errorDescription: null,
    });

    await expect(pending).resolves.toMatchObject({ status: 'failed' });
    expect(await hasGoogleDriveToken('default')).toBe(false);
  });

  it('cancelling tears the redirect listener down', async () => {
    await beginGoogleDriveAuth('default');
    await cancelGoogleDriveAuth('default');

    expect(cancelListener).toHaveBeenCalledTimes(1);
    await expect(waitForGoogleDriveAuth('default')).rejects.toThrow(
      /No active Google Drive authorization session/,
    );
  });
});
