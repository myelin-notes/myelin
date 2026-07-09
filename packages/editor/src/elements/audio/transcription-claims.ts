/**
 * Pure coordination logic for audio transcription across live peers.
 *
 * A claim is the claiming peer's id written to the element's
 * `transcribingPeerId` field the moment transcription starts (both the
 * live-recording and on-demand paths). It is valid only while that peer is
 * present in the live session — or while it is our own claim with a job
 * actually running in this window — and becomes inert once `transcript` is
 * set. There are no wall-clock leases; races resolve via Yjs LWW (worst case
 * a duplicate Whisper run, which converges).
 *
 * Auto-pickup applies only to our own orphaned claim (e.g. this window
 * reloaded mid-job): remote peers see the claim as active while we're
 * present, so no one else will ever act — resume it ourselves. Orphaned
 * claims from other peers are never auto-resumed, and imported audio that
 * was never transcribed has no claim — in both cases the manual Transcribe
 * affordance covers it.
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

/**
 * A claim binds while the claimant is present, or while it is our own claim
 * with the job still running in this window. Once `transcript` is set the
 * claim is inert. Two windows on one device share a persistent peerId, so a
 * sibling window's claim looks like our own idle claim and reads as invalid —
 * we accept the possible same-device duplicate run (it converges via LWW).
 */
export function isClaimActive(input: TranscriptionCoordinationInput): boolean {
  if (!input.claimPeerId || input.transcript) {
    return false;
  }
  if (input.claimPeerId === input.localPeerId) {
    return input.isTranscribingLocally;
  }
  return input.remotePeers.some((peer) => peer.peerId === input.claimPeerId);
}

/**
 * Whether this client should resume its own orphaned job: audio present, no
 * transcript, and our own claim with no job running in this window (e.g. this
 * window reloaded mid-job). Remote peers see our claim as active while we're
 * present, so no one else will ever act — resume it ourselves. Claims held by
 * other peers are never auto-picked-up, and a missing claim means
 * transcription was never started (an import) — the manual Transcribe
 * affordance covers both.
 */
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

/**
 * Guard for the auto-pickup effect. `shouldAutoTranscribe` alone is not
 * enough: the recording flow publishes audio via a synchronous flushSync
 * re-render that commits with the audio present but the `isTranscribingLocally`
 * signal (React state) not yet set, so that render's `shouldAutoTranscribe`
 * reads the torn intermediate state as an orphaned claim. `sessionInFlight` —
 * the transcription-session ref, which is synchronous and already accurate at
 * that instant — suppresses the duplicate run, and `alreadyAttempted` keeps a
 * failed pickup from looping.
 */
export function shouldStartAutoPickup(options: {
  eligible: boolean;
  sessionInFlight: boolean;
  alreadyAttempted: boolean;
}): boolean {
  return (
    options.eligible && !options.sessionInFlight && !options.alreadyAttempted
  );
}

/**
 * Whether the manual Transcribe affordance is actionable here: capable
 * owner-device client, untranscribed audio, and no valid claim held by
 * another peer. Replaces the old creator-only gate.
 */
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

/**
 * Recording path: the claim is written the moment live transcription starts.
 * The recording's audioData lands with an empty transcript minutes before the
 * transcript does — without an upfront claim every capable peer would offer
 * the manual Transcribe affordance in that window and invite duplicate runs.
 * Guests never claim; an incapable recorder has no transcription session and
 * therefore never claims either.
 */
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
