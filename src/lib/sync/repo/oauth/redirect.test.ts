import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ IS_MOBILE_BUILD: true }));

let deliver: ((urls: string[]) => void) | undefined;
const unlisten = vi.fn();

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: async (handler: (urls: string[]) => void) => {
    deliver = handler;
    return unlisten;
  },
}));

const { MOBILE_REDIRECT_SCHEME, startOAuthRedirectListener } = await import(
  './redirect'
);

const REDIRECT_URI = `${MOBILE_REDIRECT_SCHEME}:/oauth2redirect`;

function start() {
  return startOAuthRedirectListener({
    provider: 'Google Drive',
    mobileRedirectUri: REDIRECT_URI,
  });
}

describe('deep link OAuth redirect listener', () => {
  it('resolves the wait with the callback parameters', async () => {
    const listener = await start();
    const pending = listener.wait();

    deliver?.([`${REDIRECT_URI}?code=auth-code&state=the-state`]);

    await expect(pending).resolves.toMatchObject({
      code: 'auth-code',
      state: 'the-state',
    });
  });

  it('ends a wait already in flight when the flow is cancelled', async () => {
    const listener = await start();
    const pending = listener.wait();

    await listener.cancel();

    // Without this the caller waits forever on a redirect that is never coming.
    await expect(pending).rejects.toThrow();
    expect(unlisten).toHaveBeenCalled();
  });
});
