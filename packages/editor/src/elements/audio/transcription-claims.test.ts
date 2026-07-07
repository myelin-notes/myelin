import { describe, expect, it } from 'vitest';
import type { LivePeer, PeerMode } from '../../sync/live/peers';
import {
  canTranscribeHere,
  getTranscriptionSlotState,
  isClaimActive,
  shouldAutoTranscribe,
  shouldClaimOnRecordingStart,
  type TranscriptionCoordinationInput,
} from './transcription-claims';

function peer(peerId: string, options: { mode?: PeerMode } = {}): LivePeer {
  return {
    peerId,
    mode: options.mode ?? 'owner-device',
  };
}

function input(
  overrides: Partial<TranscriptionCoordinationInput> = {},
): TranscriptionCoordinationInput {
  return {
    hasAudio: true,
    transcript: '',
    claimPeerId: '',
    localPeerId: 'peer-b',
    localMode: 'owner-device',
    localCapable: true,
    isTranscribingLocally: false,
    remotePeers: [],
    ...overrides,
  };
}

describe('isClaimActive', () => {
  it('holds while the claiming peer is present in the session', () => {
    expect(
      isClaimActive(
        input({ claimPeerId: 'peer-c', remotePeers: [peer('peer-c')] }),
      ),
    ).toBe(true);
  });

  it('lapses when the claiming peer is absent', () => {
    expect(isClaimActive(input({ claimPeerId: 'peer-c' }))).toBe(false);
  });

  it('holds for our own claim only while the local job is running', () => {
    expect(
      isClaimActive(
        input({ claimPeerId: 'peer-b', isTranscribingLocally: true }),
      ),
    ).toBe(true);
    expect(isClaimActive(input({ claimPeerId: 'peer-b' }))).toBe(false);
  });

  it('is inert once the transcript is set', () => {
    expect(
      isClaimActive(
        input({
          claimPeerId: 'peer-c',
          transcript: 'done',
          remotePeers: [peer('peer-c')],
        }),
      ),
    ).toBe(false);
  });
});

describe('shouldAutoTranscribe', () => {
  it('picks up our own orphaned claim from a previous run', () => {
    expect(shouldAutoTranscribe(input({ claimPeerId: 'peer-b' }))).toBe(true);
  });

  it('resumes our own orphaned claim regardless of other present peers', () => {
    expect(
      shouldAutoTranscribe(
        input({ claimPeerId: 'peer-b', remotePeers: [peer('peer-a')] }),
      ),
    ).toBe(true);
  });

  it('never auto-transcribes unclaimed audio (imports)', () => {
    expect(shouldAutoTranscribe(input())).toBe(false);
  });

  it("never picks up another peer's orphaned claim, but leaves the manual affordance", () => {
    const orphaned = input({ claimPeerId: 'peer-gone' });

    expect(shouldAutoTranscribe(orphaned)).toBe(false);
    expect(canTranscribeHere(orphaned)).toBe(true);
  });

  it("respects another peer's valid claim", () => {
    expect(
      shouldAutoTranscribe(
        input({ claimPeerId: 'peer-c', remotePeers: [peer('peer-c')] }),
      ),
    ).toBe(false);
  });

  it('does nothing while our own job is still running in this window', () => {
    expect(
      shouldAutoTranscribe(
        input({ claimPeerId: 'peer-b', isTranscribingLocally: true }),
      ),
    ).toBe(false);
  });

  it('never resumes on an incapable client', () => {
    expect(
      shouldAutoTranscribe(
        input({ claimPeerId: 'peer-b', localCapable: false }),
      ),
    ).toBe(false);
  });

  it('never resumes as a guest client', () => {
    expect(
      shouldAutoTranscribe(
        input({ claimPeerId: 'peer-b', localMode: 'guest-editor' }),
      ),
    ).toBe(false);
  });

  it('does nothing once the transcript is set', () => {
    expect(
      shouldAutoTranscribe(
        input({ claimPeerId: 'peer-b', transcript: 'done' }),
      ),
    ).toBe(false);
  });
});

describe('canTranscribeHere', () => {
  it('allows a capable non-creator peer to transcribe unclaimed audio', () => {
    expect(canTranscribeHere(input())).toBe(true);
  });

  it('blocks while another present peer holds the claim', () => {
    expect(
      canTranscribeHere(
        input({ claimPeerId: 'peer-c', remotePeers: [peer('peer-c')] }),
      ),
    ).toBe(false);
  });

  it('allows retrying over an orphaned claim', () => {
    expect(canTranscribeHere(input({ claimPeerId: 'peer-gone' }))).toBe(true);
  });

  it('blocks incapable and guest clients', () => {
    expect(canTranscribeHere(input({ localCapable: false }))).toBe(false);
    expect(canTranscribeHere(input({ localMode: 'guest-viewer' }))).toBe(false);
  });
});

describe('shouldClaimOnRecordingStart', () => {
  it('claims when a live transcription session opened on an owner device', () => {
    expect(
      shouldClaimOnRecordingStart({
        transcriptionSessionStarted: true,
        localMode: 'owner-device',
      }),
    ).toBe(true);
  });

  it('never claims without a transcription session (incapable recorder)', () => {
    expect(
      shouldClaimOnRecordingStart({
        transcriptionSessionStarted: false,
        localMode: 'owner-device',
      }),
    ).toBe(false);
  });

  it('never claims as a guest', () => {
    expect(
      shouldClaimOnRecordingStart({
        transcriptionSessionStarted: true,
        localMode: 'guest-editor',
      }),
    ).toBe(false);
  });
});

describe('getTranscriptionSlotState', () => {
  it('is none without audio or once transcribed', () => {
    expect(getTranscriptionSlotState(input({ hasAudio: false }))).toEqual({
      kind: 'none',
    });
    expect(getTranscriptionSlotState(input({ transcript: 'done' }))).toEqual({
      kind: 'none',
    });
  });

  it('reports a local job', () => {
    expect(
      getTranscriptionSlotState(
        input({ claimPeerId: 'peer-b', isTranscribingLocally: true }),
      ),
    ).toEqual({ kind: 'transcribing-here' });
  });

  it('reports a valid remote claim with the claiming peer', () => {
    expect(
      getTranscriptionSlotState(
        input({ claimPeerId: 'peer-c', remotePeers: [peer('peer-c')] }),
      ),
    ).toEqual({ kind: 'transcribing-remote', peerId: 'peer-c' });
  });

  it('offers the transcribe affordance to a capable client', () => {
    expect(getTranscriptionSlotState(input())).toEqual({
      kind: 'can-transcribe',
    });
  });

  it('is unavailable on an incapable client with no valid claim', () => {
    expect(
      getTranscriptionSlotState(
        input({ localCapable: false, claimPeerId: 'peer-gone' }),
      ),
    ).toEqual({ kind: 'unavailable' });
  });
});
