/**
 * A claim is the claiming peer's id in the element's `transcribingPeerId` field, written the
 * moment transcription starts. It is valid only while that peer is present in the live session
 * (or while it is our own claim with a job running in this window) and goes inert once
 * `transcript` is set. No wall-clock leases; races resolve via Yjs LWW — worst case a duplicate
 * Whisper run, which converges.
 */

import type { LivePeer, PeerMode } from '../../sync/live/peers';

export interface TranscriptionCoordinationInput {
  hasAudio: boolean;
  transcript: string;
  /** Contents of the element's `transcribingPeerId` field; '' = never claimed. */
  claimPeerId: string;
  localPeerId: string;
  localMode: PeerMode;
  /** Whether this client's platform provides the transcription capability. */
  localCapable: boolean;
  /** Whether this window is running a transcription job for this element right now. */
  isTranscribingLocally: boolean;
  /** Remote peers currently present in the live session. */
  remotePeers: readonly LivePeer[];
}

export type TranscriptionSlotState =
  | { kind: 'none' }
  | { kind: 'transcribing-here' }
  | { kind: 'transcribing-remote'; peerId: string }
  | { kind: 'can-transcribe' }
  | { kind: 'unavailable' };

// Two windows on one device share a persistent peerId, so a sibling window's claim looks like
// our own idle claim and reads as invalid. The possible same-device duplicate run converges.
export function isClaimActive(input: TranscriptionCoordinationInput): boolean {
  if (!input.claimPeerId || input.transcript) {
    return false;
  }
  if (input.claimPeerId === input.localPeerId) {
    return input.isTranscribingLocally;
  }
  return input.remotePeers.some((peer) => peer.peerId === input.claimPeerId);
}

// Remote peers see our claim as active while we're present, so no one else will ever act.
// Claims held by other peers are never auto-picked-up, and a missing claim means transcription
// was never started (an import) — the manual Transcribe affordance covers both.
export function shouldAutoTranscribe(
  input: TranscriptionCoordinationInput,
): boolean {
  if (!input.hasAudio || input.transcript || input.isTranscribingLocally) {
    return false;
  }
  if (!input.claimPeerId || input.claimPeerId !== input.localPeerId) {
    return false;
  }
  return input.localCapable && input.localMode === 'owner-device';
}

// `shouldAutoTranscribe` alone is not enough: the recording flow publishes audio via a
// synchronous flushSync re-render that commits with audio present but `isTranscribingLocally`
// not yet set, so that render reads the torn state as an orphaned claim. `sessionInFlight` (a
// ref, already accurate) suppresses the duplicate; `alreadyAttempted` stops a failed pickup looping.
export function shouldStartAutoPickup(options: {
  eligible: boolean;
  sessionInFlight: boolean;
  alreadyAttempted: boolean;
}): boolean {
  return (
    options.eligible && !options.sessionInFlight && !options.alreadyAttempted
  );
}

// Capable owner-device client, untranscribed audio, and no valid claim held by another peer.
export function canTranscribeHere(
  input: TranscriptionCoordinationInput,
): boolean {
  if (!input.hasAudio || input.transcript || input.isTranscribingLocally) {
    return false;
  }
  if (!input.localCapable || input.localMode !== 'owner-device') {
    return false;
  }
  return !(isClaimActive(input) && input.claimPeerId !== input.localPeerId);
}

// A recording's audioData lands with an empty transcript minutes before the transcript does —
// without an upfront claim every capable peer would offer manual Transcribe in that window.
// Guests never claim; an incapable recorder has no session and so never claims either.
export function shouldClaimOnRecordingStart(options: {
  transcriptionSessionStarted: boolean;
  localMode: PeerMode;
}): boolean {
  return (
    options.transcriptionSessionStarted && options.localMode === 'owner-device'
  );
}

/** The captions-slot state for an element without a transcript. */
export function getTranscriptionSlotState(
  input: TranscriptionCoordinationInput,
): TranscriptionSlotState {
  if (!input.hasAudio || input.transcript) {
    return { kind: 'none' };
  }
  if (input.isTranscribingLocally) {
    return { kind: 'transcribing-here' };
  }
  if (isClaimActive(input) && input.claimPeerId !== input.localPeerId) {
    return { kind: 'transcribing-remote', peerId: input.claimPeerId };
  }
  if (canTranscribeHere(input)) {
    return { kind: 'can-transcribe' };
  }
  return { kind: 'unavailable' };
}
