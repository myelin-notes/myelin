import { getMessages } from '@myelin/editor/i18n';
import { invoke } from '@tauri-apps/api/core';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { IS_MOBILE_BUILD, MOBILE_PLATFORM } from '@/lib/env';
import {
  authenticateWeb,
  cancelWebAuthentication,
} from '@/platform/tauri/apple-compliance';
import { randomUrlSafeToken } from './pkce';

// A reverse-DNS scheme is what RFC 8252 asks native apps to use, and it matches the bundle
// identifier so no other app can plausibly claim it. Registered in `tauri.conf.json`,
// `AndroidManifest.xml` and `Info.plist`.
export const MOBILE_REDIRECT_SCHEME = 'com.github.wintersteve25.myelin';

// Registered on the GitHub OAuth app alongside `http://127.0.0.1/oauth/callback`.
const DEFAULT_MOBILE_REDIRECT_URI = `${MOBILE_REDIRECT_SCHEME}://oauth/callback`;

export interface OAuthCallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
}

// Started before the browser is opened so the callback cannot arrive before anything is
// listening. `redirectUri` is what gets sent to the authorization server.
export interface OAuthRedirectListener {
  redirectUri: string;
  open: (authorizeUrl: string) => Promise<void>;
  wait: () => Promise<OAuthCallbackParams>;
  cancel: () => Promise<void>;
}

export interface OAuthRedirectOptions {
  /** Provider display name, rendered on the page the browser lands on. */
  provider: string;
  // Google issues iOS and Android OAuth clients that only accept their own redirect form, so each
  // provider names the URI its client is registered against.
  mobileRedirectUri?: string;
}

interface LoopbackStart {
  redirectUri: string;
}

// Desktop captures the redirect with a loopback server. Android uses a deep link, while iOS lets
// ASWebAuthenticationSession capture the callback within its system browser.
export function startOAuthRedirectListener(
  options: OAuthRedirectOptions,
): Promise<OAuthRedirectListener> {
  if (!IS_MOBILE_BUILD) {
    return startLoopbackListener(options.provider);
  }

  const redirectUri = options.mobileRedirectUri ?? DEFAULT_MOBILE_REDIRECT_URI;
  return MOBILE_PLATFORM === 'ios'
    ? startIOSWebAuthenticationListener(redirectUri)
    : startDeepLinkListener(redirectUri);
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
    open: openUrl,
    wait: () => invoke<OAuthCallbackParams>('oauth_loopback_wait'),
    cancel: () => invoke('oauth_loopback_cancel'),
  };
}

async function startIOSWebAuthenticationListener(
  redirectUri: string,
): Promise<OAuthRedirectListener> {
  const callbackScheme = new URL(redirectUri).protocol.slice(0, -1);
  const sessionId = randomUrlSafeToken();
  let authentication: Promise<OAuthCallbackParams> | null = null;

  return {
    redirectUri,
    open: async (authorizeUrl) => {
      if (authentication) {
        throw new Error('OAuth sign-in has already started.');
      }
      authentication = authenticateWeb(
        authorizeUrl,
        callbackScheme,
        sessionId,
      ).then(({ callbackUrl }) => parseCallbackUrl(callbackUrl));
      authentication.catch(() => undefined);
    },
    wait: () =>
      authentication ??
      Promise.reject(new Error('OAuth sign-in has not started.')),
    cancel: async () => {
      if (authentication) {
        await cancelWebAuthentication(sessionId);
      }
    },
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
    open: openUrl,
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
