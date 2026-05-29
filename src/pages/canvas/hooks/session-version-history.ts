import type { NoteSession, Repository } from '@/lib/sync';

type VersionedSession = Pick<NoteSession, 'id' | 'save'>;

type VersionRepository = Pick<Repository, 'createFileVersionIfDue'>;

export async function saveSessionAndCreateVersion(
  session: VersionedSession,
  repository: VersionRepository,
): Promise<boolean> {
  const savedChanges = await session.save();

  if (savedChanges) {
    await repository.createFileVersionIfDue(session.id);
  }

  return savedChanges;
}
