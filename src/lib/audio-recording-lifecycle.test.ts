import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AudioRecordingTarget,
  startAudioRecording,
  stopAudioRecordingsForOwner,
} from '@myelin/editor/elements/audio/recording';
import type { NoteSession } from '@/lib/sync/session';
import {
  closePreservedCanvasSession,
  preserveCanvasSession,
  shutdownAudioRecordingSessions,
  takePreservedCanvasSession,
} from './audio-recording-lifecycle';

class FakeMediaRecorder {
  public static isTypeSupported(): boolean {
    return true;
  }

  public state: 'inactive' | 'recording' = 'inactive';
  public readonly mimeType = 'audio/webm';
  public ondataavailable: ((event: { data: Blob }) => void) | null = null;
  public onstop: (() => void) | null = null;

  public constructor(public readonly stream: MediaStream) {}

  public start(): void {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob(['recorded']) });
  }

  public stop(): void {
    this.state = 'inactive';
    this.onstop?.();
  }
}

function session(id: string): NoteSession {
  return {
    id,
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as NoteSession;
}

function target(): AudioRecordingTarget {
  return {
    onRecorded: vi.fn(),
    onRecordingSaved: vi.fn().mockResolvedValue(undefined),
    onTranscribed: vi.fn(),
    onTranscriptionClaimed: vi.fn(),
    onTranscriptionClaimReleased: vi.fn(),
  };
}

function installRecorder(): void {
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
    },
  });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
}

describe('audio recording lifecycle', () => {
  afterEach(async () => {
    await shutdownAudioRecordingSessions();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps duplicate note sessions scoped to their canvas tabs', async () => {
    const first = session('note-1');
    const second = session('note-1');
    preserveCanvasSession('tab-1', first);
    preserveCanvasSession('tab-2', second);

    expect(takePreservedCanvasSession('tab-1')).toBe(first);
    await closePreservedCanvasSession('tab-2');

    expect(second.close).toHaveBeenCalledOnce();
  });

  it('closes a detached session when its recording settles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    installRecorder();
    const recordingTarget = target();
    const detachedSession = session('note-1');
    await startAudioRecording(
      'audio-1',
      'tab-1',
      'owner-device',
      recordingTarget,
    );
    preserveCanvasSession('tab-1', detachedSession);
    vi.advanceTimersByTime(1500);

    await stopAudioRecordingsForOwner('tab-1');
    await Promise.resolve();

    expect(recordingTarget.onRecorded).toHaveBeenCalledOnce();
    expect(detachedSession.close).toHaveBeenCalledOnce();
  });

  it('stops and saves active recordings during shutdown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    installRecorder();
    const recordingTarget = target();
    await startAudioRecording(
      'audio-1',
      'tab-1',
      'owner-device',
      recordingTarget,
    );
    vi.advanceTimersByTime(1500);

    await shutdownAudioRecordingSessions();

    expect(recordingTarget.onRecorded).toHaveBeenCalledOnce();
    expect(recordingTarget.onRecordingSaved).toHaveBeenCalledOnce();
  });
});
