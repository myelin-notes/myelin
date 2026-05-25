import type { NoteSession, Repository } from '@/lib/sync';

type VersionedSession = Pick<NoteSession, 'hasUnsyncedChanges' | 'id' | 'save'>;

type VersionRepository = Pick<Repository, 'createFileVersionIfDue'>;

export async function saveSessionAndCreateVersion(
  session: VersionedSession,
  repository: VersionRepository,
): Promise<void> {
  const hadUnsyncedChanges = session.hasUnsyncedChanges();
  await session.save();

  if (hadUnsyncedChanges) {
    await repository.createFileVersionIfDue(session.id);
  }
}
