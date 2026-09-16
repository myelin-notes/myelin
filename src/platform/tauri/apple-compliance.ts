import { invoke } from '@tauri-apps/api/core';

interface WebAuthenticationResult {
  callbackUrl: string;
}

export function authenticateWeb(
  url: string,
  callbackScheme: string,
  sessionId: string,
): Promise<WebAuthenticationResult> {
  return invoke('plugin:apple-compliance|authenticate_web', {
    url,
    callbackScheme,
    sessionId,
  });
}

export function cancelWebAuthentication(sessionId: string): Promise<void> {
  return invoke('plugin:apple-compliance|cancel_web_authentication', {
    sessionId,
  });
}
