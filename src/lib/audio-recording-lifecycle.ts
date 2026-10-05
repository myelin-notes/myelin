import {
  stopAllAudioRecordings,
  stopAudioRecordingsForOwner,
  waitForAudioRecordingsForOwner,
} from '@myelin/editor/elements/audio/recording';
import { Logger } from '@myelin/shared/logger';
import { registerShutdownTask } from '@/lib/shutdown-tasks';
import type { NoteSession } from '@/lib/sync/session';
import type { TabId } from '@/lib/tabs/types';

const logger = new Logger('AudioRecordingLifecycle');
const preservedSessions = new Map<TabId, NoteSession>();
const detachedSessionClosures = new Set<Promise<void>>();

function trackDetachedSessionClosure(close: Promise<void>): void {
  const tracked = close
    .catch((error) => {
      logger.error('Failed to close detached canvas session', error);
    })
    .finally(() => {
      detachedSessionClosures.delete(tracked);
    });
  detachedSessionClosures.add(tracked);
}

async function closeIfStillPreserved(
  recordingOwnerId: TabId,
  session: NoteSession,
): Promise<void> {
  if (preservedSessions.get(recordingOwnerId) !== session) {
    return;
  }
  preservedSessions.delete(recordingOwnerId);
  await session.close();
}

export function preserveCanvasSession(
  recordingOwnerId: TabId,
  session: NoteSession,
): void {
  preservedSessions.set(recordingOwnerId, session);
  const recording = waitForAudioRecordingsForOwner(recordingOwnerId);
  trackDetachedSessionClosure(
    (recording ?? Promise.resolve()).then(() =>
      closeIfStillPreserved(recordingOwnerId, session),
    ),
  );
}

export function takePreservedCanvasSession(
  recordingOwnerId: TabId,
): NoteSession | null {
  const session = preservedSessions.get(recordingOwnerId) ?? null;
  preservedSessions.delete(recordingOwnerId);
  return session;
}

export function closePreservedCanvasSession(
  recordingOwnerId: TabId,
): Promise<void> | null {
  const session = takePreservedCanvasSession(recordingOwnerId);
  return session?.close() ?? null;
}

export function prepareCanvasTabClose(
  recordingOwnerId: TabId,
): Promise<void> | undefined {
  const stopRecording = stopAudioRecordingsForOwner(recordingOwnerId);
  if (stopRecording) {
    return stopRecording.then(async () => {
      await closePreservedCanvasSession(recordingOwnerId);
    });
  }
  return closePreservedCanvasSession(recordingOwnerId) ?? undefined;
}

export async function shutdownAudioRecordingSessions(): Promise<void> {
  await stopAllAudioRecordings();
  const sessions = Array.from(preservedSessions.values());
  preservedSessions.clear();
  await Promise.all([
    ...sessions.map((session) => session.close()),
    ...detachedSessionClosures,
  ]);
}

export function registerAudioRecordingShutdownTask(): () => void {
  return registerShutdownTask(shutdownAudioRecordingSessions);
}
