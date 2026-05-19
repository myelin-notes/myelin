import { describe, expect, it } from 'vitest';
import {
  finishManualRepositoryRefresh,
  MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS,
  reserveManualRepositoryRefresh,
  resetManualRepositoryRefreshForTests,
} from './manual-refresh';

describe('manual repository refresh cooldown', () => {
  it('allows one refresh at a time', () => {
    resetManualRepositoryRefreshForTests();

    expect(reserveManualRepositoryRefresh(10_000)).toBe(true);
    expect(reserveManualRepositoryRefresh(10_001)).toBe(false);

    finishManualRepositoryRefresh();
    expect(reserveManualRepositoryRefresh(10_002)).toBe(false);
  });

  it('allows another refresh after the cooldown', () => {
    resetManualRepositoryRefreshForTests();

    expect(reserveManualRepositoryRefresh(10_000)).toBe(true);
    finishManualRepositoryRefresh();

    expect(
      reserveManualRepositoryRefresh(
        10_000 + MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS,
      ),
    ).toBe(true);
  });
});
