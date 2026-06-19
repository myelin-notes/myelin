import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CachedRepositoryOutbox, type PendingOp } from './outbox';

const fsState = {
  exists: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
};

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData', AppCache: 'AppCache' },
  exists: (...args: unknown[]) => fsState.exists(...args),
  mkdir: (...args: unknown[]) => fsState.mkdir(...args),
  readTextFile: (...args: unknown[]) => fsState.readTextFile(...args),
  writeTextFile: (...args: unknown[]) => fsState.writeTextFile(...args),
  rename: (...args: unknown[]) => fsState.rename(...args),
}));

function makeOutbox(onRecoveryError = vi.fn()) {
  return new CachedRepositoryOutbox({
    path: 'cache/outbox.json',
    repositoryKind: 'test',
    onPendingWritesChanged: vi.fn(),
    onRecoveryError,
  });
}

const validOp: PendingOp = {
  kind: 'upsert-manifest-node',
  nodeId: 'node-1',
  queueRevision: 'rev-1',
};

beforeEach(() => {
  fsState.exists.mockReset();
  fsState.mkdir.mockReset();
  fsState.readTextFile.mockReset();
  fsState.writeTextFile.mockReset();
  fsState.rename.mockReset();

  // Parent dir exists; outbox file exists.
  fsState.exists.mockResolvedValue(true);
  fsState.mkdir.mockResolvedValue(undefined);
  fsState.writeTextFile.mockResolvedValue(undefined);
  fsState.rename.mockResolvedValue(undefined);
});

describe('CachedRepositoryOutbox.load', () => {
  it('Case A: a transient read I/O error propagates and does NOT quarantine', async () => {
    const ioError = new Error('EBUSY: resource busy or locked');
    fsState.readTextFile.mockRejectedValue(ioError);
    const onRecoveryError = vi.fn();
    const outbox = makeOutbox(onRecoveryError);

    await expect(outbox.load()).rejects.toThrow(ioError);

    // Did NOT quarantine: no rename, no recoveryError, no recovery callback.
    expect(fsState.rename).not.toHaveBeenCalled();
    expect(onRecoveryError).not.toHaveBeenCalled();
    expect(outbox.recoveryError).toBeNull();
  });

  it('Case B: a failed migration write() does NOT quarantine', async () => {
    // Entry missing queueRevision -> normalization fills it -> migration write().
    fsState.readTextFile.mockResolvedValue(
      JSON.stringify([{ kind: 'upsert-manifest-node', nodeId: 'node-1' }]),
    );
    const writeError = new Error('ENOSPC: no space left on device');
    fsState.writeTextFile.mockRejectedValue(writeError);
    const onRecoveryError = vi.fn();
    const outbox = makeOutbox(onRecoveryError);

    await expect(outbox.load()).rejects.toThrow(writeError);

    expect(fsState.rename).not.toHaveBeenCalled();
    expect(onRecoveryError).not.toHaveBeenCalled();
    expect(outbox.recoveryError).toBeNull();
    // The still-valid pending op survives in memory.
    expect(outbox.length).toBe(1);
  });

  it('genuine corruption (invalid JSON) still quarantines', async () => {
    fsState.readTextFile.mockResolvedValue('{not json');
    const onRecoveryError = vi.fn();
    const outbox = makeOutbox(onRecoveryError);

    await outbox.load();

    expect(fsState.rename).toHaveBeenCalledTimes(1);
    expect(onRecoveryError).toHaveBeenCalledTimes(1);
    expect(outbox.recoveryError).not.toBeNull();
    expect(outbox.length).toBe(0);
  });

  it('a valid outbox loads its pending ops without quarantine', async () => {
    fsState.readTextFile.mockResolvedValue(JSON.stringify([validOp]));
    const outbox = makeOutbox();

    await outbox.load();

    expect(fsState.rename).not.toHaveBeenCalled();
    expect(outbox.recoveryError).toBeNull();
    expect(outbox.length).toBe(1);
  });
});
