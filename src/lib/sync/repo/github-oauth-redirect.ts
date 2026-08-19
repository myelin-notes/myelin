import { invoke } from '@tauri-apps/api/core';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { IS_MOBILE_BUILD } from '@/lib/env';
import { getMessages } from '@/lib/i18n';

// Registered on the GitHub OAuth app alongside `http://127.0.0.1/oauth/callback`.
// A reverse-DNS scheme is what RFC 8252 asks native apps to use, and it matches
// the bundle identifier so no other app on the device can plausibly claim it.
const MOBILE_REDIRECT_URI = 'com.github.wintersteve25.myelin://oauth/callback';

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

interface LoopbackStart {
  redirectUri: string;
}

/**
 * Desktop captures the redirect with a throwaway loopback server on an
 * ephemeral port; mobile has no such server, so it captures a deep link back
 * into the app instead.
 */
export function startOAuthRedirectListener(): Promise<OAuthRedirectListener> {
  return IS_MOBILE_BUILD ? startDeepLinkListener() : startLoopbackListener();
}

async function startLoopbackListener(): Promise<OAuthRedirectListener> {
  const page = getMessages().settings.repository.auth.browserCallback;
  const { redirectUri } = await invoke<LoopbackStart>('oauth_loopback_start', {
    title: page.title,
    message: page.message,
  });

  return {
    redirectUri,
    wait: () => invoke<OAuthCallbackParams>('oauth_loopback_wait'),
    cancel: () => invoke('oauth_loopback_cancel'),
  };
}

async function startDeepLinkListener(): Promise<OAuthRedirectListener> {
  let settle: ((params: OAuthCallbackParams) => void) | null = null;
  const received = new Promise<OAuthCallbackParams>((resolve) => {
    settle = resolve;
  });

  const unlisten = await onOpenUrl((urls) => {
    const match = urls.find((url) => url.startsWith(MOBILE_REDIRECT_URI));
    if (match) {
      settle?.(parseCallbackUrl(match));
    }
  });

  return {
    redirectUri: MOBILE_REDIRECT_URI,
    wait: () => received,
    cancel: async () => {
      unlisten();
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
