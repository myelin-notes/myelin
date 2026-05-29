import { describe, expect, it, vi } from 'vitest';
import { saveSessionAndCreateVersion } from './session-version-history';

describe('saveSessionAndCreateVersion', () => {
  it('creates a version after saving a dirty session', async () => {
    const session = {
      id: 'note-1',
      hasUnsyncedChanges: vi.fn(() => true),
      save: vi.fn(async () => true),
    };
    const repository = {
      createFileVersionIfDue: vi.fn(async () => null),
    };

    await saveSessionAndCreateVersion(session, repository);

    expect(session.save).toHaveBeenCalledOnce();
    expect(repository.createFileVersionIfDue).toHaveBeenCalledWith('note-1');
  });

  it('skips version creation when the session has no local changes', async () => {
    const session = {
      id: 'note-1',
      hasUnsyncedChanges: vi.fn(() => false),
      save: vi.fn(async () => false),
    };
    const repository = {
      createFileVersionIfDue: vi.fn(async () => null),
    };

    await saveSessionAndCreateVersion(session, repository);

    expect(session.save).toHaveBeenCalledOnce();
    expect(repository.createFileVersionIfDue).not.toHaveBeenCalled();
  });

  it('creates a version when the save reports changes committed during teardown', async () => {
    const session = {
      id: 'note-1',
      hasUnsyncedChanges: vi.fn(() => false),
      save: vi.fn(async () => true),
    };
    const repository = {
      createFileVersionIfDue: vi.fn(async () => null),
    };

    await saveSessionAndCreateVersion(session, repository);

    expect(session.save).toHaveBeenCalledOnce();
    expect(repository.createFileVersionIfDue).toHaveBeenCalledWith('note-1');
  });
});
