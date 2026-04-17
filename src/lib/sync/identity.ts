import { UserPrefs } from '../user-prefs';

function createPeerId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `peer-${Math.random().toString(36).slice(2, 12)}`;
}

export function getOrCreatePeerId(): string {
  const existing = UserPrefs.get('peerId');
  if (typeof existing === 'string' && existing.trim().length > 0) {
    return existing;
  }

  const peerId = createPeerId();
  UserPrefs.set('peerId', peerId);
  return peerId;
}

export function createEphemeralPeerId(): string {
  return createPeerId();
}
