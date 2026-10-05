import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { invoke, sdk } = vi.hoisted(() => ({
  invoke: vi.fn(),
  sdk: {
    captureException: vi.fn(),
    init: vi.fn(),
    register: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    get_distinct_id: () => 'current-person',
    get_session_id: () => 'current-session',
  },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('posthog-js', () => ({ default: sdk }));
vi.mock('@/lib/env', () => ({
  POSTHOG_KEY: 'test-key',
  POSTHOG_HOST: 'https://posthog.test',
  MODE: 'test',
}));

const report = {
  id: '9a5c1537-dc54-4f5b-afac-f681d65b802d',
  kind: 'native_crash',
  reason: 'Invalid memory access (code 0x1)',
  appVersion: '1.2.0',
  platform: 'macos',
  timestamp: '2026-10-04T12:34:56+00:00',
  distinctId: 'crashed-person',
  sessionId: 'crashed-session',
  code: 1,
  detail: '0x1',
  address: '0x0',
};

async function launch(enabled: boolean) {
  const { UserPrefs } = await import('@myelin/editor/user-prefs');
  UserPrefs.set('analyticsEnabled', enabled);
  const { initErrorTracking } = await import('./posthog');
  initErrorTracking();
  return UserPrefs;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('hands a saved crash to the SDK and immediately acknowledges it', async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'configure_crash_reporting') {
      return [report];
    }
  });
  await launch(true);
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('acknowledge_crash_report', {
      id: report.id,
    }),
  );
  expect(sdk.captureException).toHaveBeenCalledWith(
    report.reason,
    expect.objectContaining({
      distinct_id: 'crashed-person',
      crash_session_id: 'crashed-session',
      app_version: '1.2.0',
      crash_report_id: report.id,
      crash_timestamp: report.timestamp,
      $exception_list: [
        {
          type: 'NativeCrash',
          value: report.reason,
          mechanism: { type: 'native_crash', handled: false, synthetic: false },
        },
      ],
    }),
  );
});

it('does not report saved crashes when analytics is disabled', async () => {
  invoke.mockResolvedValue([]);
  await launch(false);
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('configure_crash_reporting', {
      enabled: false,
      distinctId: null,
      sessionId: null,
    }),
  );
  expect(sdk.captureException).not.toHaveBeenCalled();
});

it('does not report pending crashes if analytics is turned off while loading them', async () => {
  let finishConfiguration: (() => void) | undefined;
  invoke.mockImplementation((command: string, args: { enabled?: boolean }) => {
    if (command === 'configure_crash_reporting' && args.enabled) {
      return new Promise((resolve) => {
        finishConfiguration = () => resolve([report]);
      });
    }
    return Promise.resolve([]);
  });
  const prefs = await launch(true);
  await vi.waitFor(() => expect(finishConfiguration).toBeDefined());
  prefs.set('analyticsEnabled', false);
  finishConfiguration!();
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('configure_crash_reporting', {
      enabled: false,
      distinctId: null,
      sessionId: null,
    }),
  );
  expect(sdk.captureException).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalledWith(
    'acknowledge_crash_report',
    expect.anything(),
  );
});
