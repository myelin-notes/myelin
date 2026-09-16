import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  IS_MOBILE_BUILD: true,
  MOBILE_PLATFORM: 'ios',
}));

let resolveAuthentication: (result: { callbackUrl: string }) => void;
const authenticateWeb = vi.fn(
  (_url: string, _callbackScheme: string, _sessionId: string) =>
    new Promise<{ callbackUrl: string }>((resolve) => {
      resolveAuthentication = resolve;
    }),
);
const cancelWebAuthentication = vi.fn(async (_sessionId: string) => {});

vi.mock('@/platform/tauri/apple-compliance', () => ({
  authenticateWeb,
  cancelWebAuthentication,
}));

const { MOBILE_REDIRECT_SCHEME, startOAuthRedirectListener } = await import(
  './redirect'
);

const REDIRECT_URI = `${MOBILE_REDIRECT_SCHEME}:/oauth2redirect`;
const AUTHORIZE_URL = 'https://accounts.example.com/oauth/authorize';

function start() {
  return startOAuthRedirectListener({
    provider: 'Google Drive',
    mobileRedirectUri: REDIRECT_URI,
  });
}

describe('iOS web authentication session', () => {
  beforeEach(() => {
    authenticateWeb.mockClear();
    cancelWebAuthentication.mockClear();
  });

  it('opens and receives the callback through the native session', async () => {
    const listener = await start();
    await listener.open(AUTHORIZE_URL);
    const pending = listener.wait();

    expect(authenticateWeb).toHaveBeenCalledWith(
      AUTHORIZE_URL,
      MOBILE_REDIRECT_SCHEME,
      expect.any(String),
    );

    resolveAuthentication({
      callbackUrl: `${REDIRECT_URI}?code=auth-code&state=the-state`,
    });

    await expect(pending).resolves.toMatchObject({
      code: 'auth-code',
      state: 'the-state',
    });
  });

  it('cancels the native session', async () => {
    const listener = await start();
    await listener.open(AUTHORIZE_URL);

    await listener.cancel();

    expect(cancelWebAuthentication).toHaveBeenCalledWith(
      authenticateWeb.mock.calls[0]?.[2],
    );
  });
});
