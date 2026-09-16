import { invoke } from '@tauri-apps/api/core';

export interface TrackingAuthorization {
  status: 'notDetermined' | 'restricted' | 'denied' | 'authorized';
}

export function getTrackingAuthorizationStatus(): Promise<TrackingAuthorization> {
  return invoke('plugin:apple-compliance|get_tracking_authorization_status');
}

export function requestTrackingAuthorization(): Promise<TrackingAuthorization> {
  return invoke('plugin:apple-compliance|request_tracking_authorization');
}
