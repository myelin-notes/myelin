import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import {
  flushLogs,
  getLogFilePath,
  initializeLogging,
  Logger,
  resetLoggingForTests,
} from './logger';

describe('Logger', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
    resetLoggingForTests({
      mode: 'development',
      persistDebug: false,
      maxFileBytes: 8192,
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

    const raw = getRepositoryTestStorage().readText(getLogFilePath());
    expect(raw).toBeTruthy();
    const entry = JSON.parse(raw!.trim()) as {
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

    const raw = getRepositoryTestStorage().readText(getLogFilePath());
    const entry = JSON.parse(raw!.trim()) as {
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

  it('serializes concurrent writes through a single file sink', async () => {
    const logger = new Logger('Concurrent');
    for (let i = 0; i < 5; i++) {
      logger.info(`message-${i}`);
    }

    await flushLogs();

    const raw = getRepositoryTestStorage().readText(getLogFilePath()) ?? '';
    const lines = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { message: string });

    expect(lines).toHaveLength(5);
    expect(lines.map((line) => line.message)).toEqual([
      'message-0',
      'message-1',
      'message-2',
      'message-3',
      'message-4',
    ]);
  });

  it('trims the log file to the configured size cap', async () => {
    resetLoggingForTests({
      mode: 'development',
      persistDebug: false,
      maxFileBytes: 180,
    });
    const logger = new Logger('Trim');
    logger.info('first entry that should be rotated out');
    logger.info('second entry that should survive');
    logger.info('third entry that should survive');

    await flushLogs();

    const raw = getRepositoryTestStorage().readText(getLogFilePath()) ?? '';
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(180);
    expect(raw).not.toContain('first entry that should be rotated out');
  });

  it('applies console policy by environment', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    resetLoggingForTests({
      mode: 'production',
      persistDebug: false,
      maxFileBytes: 8192,
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

  it('captures global errors and unhandled rejections', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const target = new EventTarget();
    initializeLogging(target);

    const errorEvent = new Event('error');
    Object.assign(errorEvent, {
      message: 'window boom',
      error: new Error('window boom'),
      filename: '/test.ts',
      lineno: 4,
      colno: 2,
    });
    target.dispatchEvent(errorEvent);

    const rejectionEvent = new Event('unhandledrejection');
    Object.assign(rejectionEvent, {
      reason: new Error('rejected'),
    });
    target.dispatchEvent(rejectionEvent);

    await flushLogs();

    const raw = getRepositoryTestStorage().readText(getLogFilePath()) ?? '';
    expect(raw).toContain('"subsystem":"GlobalError"');
    expect(raw).toContain('"subsystem":"UnhandledRejection"');
    expect(errorSpy).toHaveBeenCalled();
  });
});
