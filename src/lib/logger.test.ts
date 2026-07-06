import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '@/platform';
import { createFakePlatform } from '@/test/fake-platform';
import { flushLogs, Logger, resetLoggingForTests } from './logger';

describe('Logger', () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    setPlatform(
      createFakePlatform({
        writeLogs: async (lines) => {
          written.push(...lines);
        },
      }),
    );
    resetLoggingForTests({
      mode: 'development',
      persistDebug: false,
    });
    vi.restoreAllMocks();
  });

  it('persists structured entries for plain messages and metadata', async () => {
    const logger = new Logger('UserPrefs');
    logger.info('Loaded preferences', {
      key: 'language',
      value: 'en',
    });

    await flushLogs();

    expect(written).toHaveLength(1);
    const entry = JSON.parse(written[0]) as {
      level: string;
      subsystem: string;
      message: string;
      metadata?: Record<string, unknown>;
    };
    expect(entry.level).toBe('info');
    expect(entry.subsystem).toBe('UserPrefs');
    expect(entry.message).toBe('Loaded preferences');
    expect(entry.metadata).toEqual({
      key: 'language',
      value: 'en',
    });
  });

  it('serializes errors and redacts sensitive metadata', async () => {
    const logger = new Logger('Auth');
    logger.error('Failed auth', new Error('boom'), {
      token: 'secret-token',
      credentialId: 'abc',
      owner: 'me',
    });

    await flushLogs();

    expect(written).toHaveLength(1);
    const entry = JSON.parse(written[0]) as {
      error?: { name: string; message: string; stack?: string };
      metadata?: Record<string, unknown>;
    };
    expect(entry.error?.name).toBe('Error');
    expect(entry.error?.message).toBe('boom');
    expect(entry.metadata).toEqual({
      token: '[REDACTED]',
      credentialId: '[REDACTED]',
      owner: 'me',
    });
  });

  it('serializes concurrent writes through a single sink', async () => {
    const logger = new Logger('Concurrent');
    for (let i = 0; i < 5; i++) {
      logger.info(`message-${i}`);
    }

    await flushLogs();

    const lines = written.map(
      (line) => JSON.parse(line) as { message: string },
    );
    expect(lines).toHaveLength(5);
    expect(lines.map((line) => line.message)).toEqual([
      'message-0',
      'message-1',
      'message-2',
      'message-3',
      'message-4',
    ]);
  });

  it('applies console policy by environment', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    resetLoggingForTests({
      mode: 'production',
      persistDebug: false,
    });

    const logger = new Logger('Policy');
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    await flushLogs();

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
