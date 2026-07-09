import { beforeEach, describe, expect, it } from 'vitest';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { getLogFilePath, resetLogSinkForTests, writeLogs } from './log-sink';

describe('tauri log sink', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
    resetLogSinkForTests();
  });

  it('appends lines to the log file', async () => {
    await writeLogs(['{"message":"one"}']);
    await writeLogs(['{"message":"two"}']);

    const raw = getRepositoryTestStorage().readText(getLogFilePath());
    expect(raw).toBe('{"message":"one"}\n{"message":"two"}\n');
  });

  it('trims the log file to the configured size cap', async () => {
    await writeLogs(['first entry that should be rotated out'], 80);
    await writeLogs(['second entry that should survive'], 80);
    await writeLogs(['third entry that should survive'], 80);

    const raw = getRepositoryTestStorage().readText(getLogFilePath()) ?? '';
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(80);
    expect(raw).not.toContain('first entry that should be rotated out');
    expect(raw).toContain('third entry that should survive');
  });
});
