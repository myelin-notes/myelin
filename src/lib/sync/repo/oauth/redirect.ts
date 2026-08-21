import { invoke } from '@tauri-apps/api/core';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { IS_MOBILE_BUILD } from '@/lib/env';
import { getMessages } from '@/lib/i18n';

/**
 * A reverse-DNS scheme is what RFC 8252 asks native apps to use, and it matches
 * the bundle identifier so no other app on the device can plausibly claim it.
 * Registered in `tauri.conf.json`, `AndroidManifest.xml` and `Info.plist`.
 */
export const MOBILE_REDIRECT_SCHEME = 'com.github.wintersteve25.myelin';

// Registered on the GitHub OAuth app alongside `http://127.0.0.1/oauth/callback`.
const DEFAULT_MOBILE_REDIRECT_URI = `${MOBILE_REDIRECT_SCHEME}://oauth/callback`;

export interface OAuthCallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
}

/**
 * A live redirect capture, started before the browser is opened so the callback
 * cannot arrive before anything is listening. `redirectUri` is what gets sent to
 * the authorization server.
 */
export interface OAuthRedirectListener {
  redirectUri: string;
  wait: () => Promise<OAuthCallbackParams>;
  cancel: () => Promise<void>;
}

export interface OAuthRedirectOptions {
  /** Provider display name, rendered on the page the browser lands on. */
  provider: string;
  /**
   * Overrides the deep link the mobile flow listens for. Google issues iOS and
   * Android OAuth clients that only accept their own redirect form, so each
   * provider names the URI its client is registered against.
   */
  mobileRedirectUri?: string;
}

interface LoopbackStart {
  redirectUri: string;
}

/**
 * Desktop captures the redirect with a throwaway loopback server on an
 * ephemeral port; mobile has no such server, so it captures a deep link back
 * into the app instead.
 */
export function startOAuthRedirectListener(
  options: OAuthRedirectOptions,
): Promise<OAuthRedirectListener> {
  return IS_MOBILE_BUILD
    ? startDeepLinkListener(
        options.mobileRedirectUri ?? DEFAULT_MOBILE_REDIRECT_URI,
      )
    : startLoopbackListener(options.provider);
}

async function startLoopbackListener(
  provider: string,
): Promise<OAuthRedirectListener> {
  const page = getMessages().settings.repository.auth.browserCallback;
  const { redirectUri } = await invoke<LoopbackStart>('oauth_loopback_start', {
    title: page.title(provider),
    message: page.message,
  });

  return {
    redirectUri,
    wait: () => invoke<OAuthCallbackParams>('oauth_loopback_wait'),
    cancel: () => invoke('oauth_loopback_cancel'),
  };
}

async function startDeepLinkListener(
  redirectUri: string,
): Promise<OAuthRedirectListener> {
  let settle: ((params: OAuthCallbackParams) => void) | null = null;
  let abandon: ((reason: Error) => void) | null = null;
  const received = new Promise<OAuthCallbackParams>((resolve, reject) => {
    settle = resolve;
    abandon = reject;
  });
  // Cancelling often happens before anything awaits `received`, and an
  // unobserved rejection is reported as an unhandled one.
  received.catch(() => undefined);

  const unlisten = await onOpenUrl((urls) => {
    const match = urls.find((url) => url.startsWith(redirectUri));
    if (match) {
      settle?.(parseCallbackUrl(match));
    }
  });

  return {
    redirectUri,
    wait: () => received,
    cancel: async () => {
      unlisten();
      // Settles a wait already in flight: no redirect is coming now.
      abandon?.(new Error('OAuth sign-in was cancelled.'));
    },
  };
}

function parseCallbackUrl(url: string): OAuthCallbackParams {
  const query = new URL(url).searchParams;
  return {
    code: query.get('code'),
    state: query.get('state'),
    error: query.get('error'),
    errorDescription: query.get('error_description'),
  };
}
