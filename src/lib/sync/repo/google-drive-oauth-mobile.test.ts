import { describe, expect, it, vi } from 'vitest';
import type { OAuthCallbackParams } from './oauth/redirect';

// Kept apart from google-drive-oauth.test.ts because the platform is baked in
// at module load: `@/lib/env` reports one platform per build.
vi.unmock('@/lib/sync/repo/google-drive-credentials');

vi.mock('@/lib/env', () => ({
  IS_DEV: false,
  MODE: 'test',
  IS_MOBILE_BUILD: true,
  MOBILE_PLATFORM: 'android',
  GITHUB_CLIENT_ID: 'test-github-client-id',
  GITHUB_CLIENT_SECRET: 'test-github-client-secret',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  GOOGLE_CLIENT_ID_IOS: '',
  GOOGLE_CLIENT_ID_ANDROID: 'test-android-client-id',
  LIVE_DISCOVERY_URL: 'https://live.test',
  POSTHOG_KEY: '',
  POSTHOG_HOST: '',
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => {}),
}));

const MOBILE_REDIRECT_URI = 'com.github.wintersteve25.myelin:/oauth2redirect';

let resolveRedirect: (params: OAuthCallbackParams) => void;
let requestedRedirectUri: string | undefined;

vi.mock('./oauth/redirect', () => ({
  MOBILE_REDIRECT_SCHEME: 'com.github.wintersteve25.myelin',
  startOAuthRedirectListener: async (options: {
    mobileRedirectUri?: string;
  }) => {
    requestedRedirectUri = options.mobileRedirectUri;
    return {
      redirectUri: options.mobileRedirectUri ?? '',
      wait: () =>
        new Promise<OAuthCallbackParams>((resolve) => {
          resolveRedirect = resolve;
        }),
      cancel: async () => {},
    };
  },
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

const tokenRequests: Array<Record<string, string>> = [];

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(async (_url: string, init: { body: string }) => {
    tokenRequests.push(
      Object.fromEntries(new URLSearchParams(init.body)) as Record<
        string,
        string
      >,
    );
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        }),
    };
  }),
}));

const {
  beginGoogleDriveAuth,
  isGoogleDriveAuthAvailable,
  waitForGoogleDriveAuth,
} = await import('./google-drive-credentials');

describe('Google Drive OAuth on Android', () => {
  it('uses the Android client and the custom scheme, with no secret', async () => {
    // The Android client type is a true public client, so requiring a secret
    // here would make sign-in permanently unavailable on the platform.
    expect(await isGoogleDriveAuthAvailable()).toBe(true);

    const { authorizeUrl } = await beginGoogleDriveAuth('default');
    const query = new URL(authorizeUrl).searchParams;

    expect(requestedRedirectUri).toBe(MOBILE_REDIRECT_URI);
    expect(query.get('client_id')).toBe('test-android-client-id');
    expect(query.get('redirect_uri')).toBe(MOBILE_REDIRECT_URI);

    const pending = waitForGoogleDriveAuth('default');
    resolveRedirect({
      code: 'auth-code',
      state: query.get('state'),
      error: null,
      errorDescription: null,
    });
    await expect(pending).resolves.toMatchObject({ status: 'complete' });

    expect(tokenRequests.at(-1)?.client_id).toBe('test-android-client-id');
    expect(tokenRequests.at(-1)?.client_secret).toBeUndefined();
  });
});
