import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  posthog: {
    init: vi.fn(),
    register: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  },
  getStatus: vi.fn(),
  request: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: mocks.posthog }));
vi.mock('@/platform/tauri/apple-compliance', () => ({
  getTrackingAuthorizationStatus: mocks.getStatus,
  requestTrackingAuthorization: mocks.request,
}));
vi.mock('@myelin/shared/logger', () => ({
  Logger: class {
    error = mocks.logError;
  },
}));

async function load(platform: 'ios' | 'android' | null = 'ios') {
  vi.doMock('@/lib/env', () => ({
    MOBILE_PLATFORM: platform,
    MODE: 'test',
    POSTHOG_HOST: 'https://example.com',
    POSTHOG_KEY: 'test-key',
  }));
  const { UserPrefs } = await import('@myelin/editor/user-prefs');
  const tracking = await import('./posthog');
  return { UserPrefs, ...tracking };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.getStatus.mockResolvedValue({ status: 'notDetermined' });
});

describe('Apple tracking consent', () => {
  it('does not prompt or initialize analytics before onboarding finishes', async () => {
    const tracking = await load();
    tracking.UserPrefs.set('analyticsEnabled', true);
    tracking.initErrorTracking();

    expect(await tracking.syncAppleTrackingConsent()).toBe(false);
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.posthog.init).not.toHaveBeenCalled();
  });

  it('waits for native authorization even with a saved opt-in and concurrent requests', async () => {
    let authorize: (value: { status: 'authorized' }) => void = () => {};
    mocks.request.mockReturnValue(
      new Promise((resolve) => {
        authorize = resolve;
      }),
    );
    const tracking = await load();
    tracking.UserPrefs.set('analyticsEnabled', true);
    tracking.UserPrefs.set('onboardingCompleted', true);
    tracking.initErrorTracking();

    const first = tracking.syncAppleTrackingConsent();
    const second = tracking.syncAppleTrackingConsent();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    expect(mocks.getStatus).toHaveBeenCalledOnce();
    expect(mocks.posthog.init).not.toHaveBeenCalled();
    expect(tracking.isErrorTrackingEnabled()).toBe(false);

    authorize({ status: 'authorized' });
    expect(await first).toBe(true);
    expect(mocks.posthog.init).toHaveBeenCalledOnce();
    expect(tracking.isErrorTrackingEnabled()).toBe(true);
  });

  it('enables analytics when a first-time request is authorized', async () => {
    mocks.request.mockResolvedValue({ status: 'authorized' });
    const tracking = await load();
    tracking.UserPrefs.set('onboardingCompleted', true);
    tracking.initErrorTracking();

    expect(await tracking.syncAppleTrackingConsent()).toBe(true);
    expect(tracking.UserPrefs.get('analyticsEnabled')).toBe(true);
    expect(mocks.posthog.opt_in_capturing).toHaveBeenCalledWith({
      captureEventName: false,
    });
  });

  it.each([
    'denied',
    'restricted',
    'notDetermined',
  ])('keeps capture off for %s, even if Settings enables the preference', async (status) => {
    mocks.request.mockResolvedValue({ status });
    const tracking = await load();
    tracking.UserPrefs.set('onboardingCompleted', true);
    tracking.initErrorTracking();

    expect(await tracking.syncAppleTrackingConsent()).toBe(false);
    expect(tracking.UserPrefs.get('analyticsEnabled')).toBe(false);
    tracking.UserPrefs.set('analyticsEnabled', true);
    expect(mocks.posthog.init).not.toHaveBeenCalled();
    expect(tracking.isErrorTrackingEnabled()).toBe(false);
  });

  it('preserves an in-app opt-out when native permission is already granted', async () => {
    mocks.getStatus.mockResolvedValue({ status: 'authorized' });
    const tracking = await load();
    tracking.UserPrefs.set('onboardingCompleted', true);
    tracking.initErrorTracking();

    expect(await tracking.syncAppleTrackingConsent()).toBe(true);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(tracking.UserPrefs.get('analyticsEnabled')).toBe(false);
    expect(mocks.posthog.init).not.toHaveBeenCalled();
  });

  it('suspends capture during a recheck and applies native revocation', async () => {
    mocks.request.mockResolvedValue({ status: 'authorized' });
    const tracking = await load();
    tracking.UserPrefs.set('onboardingCompleted', true);
    tracking.initErrorTracking();
    await tracking.syncAppleTrackingConsent();

    mocks.getStatus.mockResolvedValue({ status: 'denied' });
    const recheck = tracking.syncAppleTrackingConsent();
    expect(tracking.isErrorTrackingEnabled()).toBe(false);
    expect(mocks.posthog.opt_out_capturing).toHaveBeenCalled();
    expect(await recheck).toBe(false);
    expect(tracking.UserPrefs.get('analyticsEnabled')).toBe(false);
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it('keeps analytics off if the native command fails', async () => {
    mocks.getStatus.mockRejectedValue(new Error('native command failed'));
    const tracking = await load();
    tracking.UserPrefs.set('analyticsEnabled', true);
    tracking.UserPrefs.set('onboardingCompleted', true);
    tracking.initErrorTracking();

    expect(await tracking.syncAppleTrackingConsent()).toBe(false);
    expect(mocks.posthog.init).not.toHaveBeenCalled();
    expect(tracking.isErrorTrackingEnabled()).toBe(false);
    expect(mocks.logError).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    'android',
  ] as const)('preserves existing analytics behavior on platform %s', async (platform) => {
    const tracking = await load(platform);
    tracking.UserPrefs.set('analyticsEnabled', true);
    tracking.initErrorTracking();

    expect(mocks.posthog.init).toHaveBeenCalledOnce();
    expect(tracking.isErrorTrackingEnabled()).toBe(true);
    expect(await tracking.syncAppleTrackingConsent()).toBe(false);
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    tracking.UserPrefs.set('analyticsEnabled', false);
    expect(mocks.posthog.opt_out_capturing).toHaveBeenCalled();
  });
});
