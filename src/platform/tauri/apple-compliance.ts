import { invoke } from '@tauri-apps/api/core';

export interface TrackingAuthorization {
  status: 'notDetermined' | 'restricted' | 'denied' | 'authorized';
}

interface WebAuthenticationResult {
  callbackUrl: string;
}

export function getTrackingAuthorizationStatus(): Promise<TrackingAuthorization> {
  return invoke('plugin:apple-compliance|get_tracking_authorization_status');
}

export function requestTrackingAuthorization(): Promise<TrackingAuthorization> {
  return invoke('plugin:apple-compliance|request_tracking_authorization');
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
