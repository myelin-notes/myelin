export const MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS = 5_000;

let lastManualRepositoryRefreshStartedAt = 0;
let manualRepositoryRefreshInFlight = false;

export function reserveManualRepositoryRefresh(now = Date.now()): boolean {
  if (manualRepositoryRefreshInFlight) {
    return false;
  }

  if (
    now - lastManualRepositoryRefreshStartedAt <
    MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS
  ) {
    return false;
  }

  lastManualRepositoryRefreshStartedAt = now;
  manualRepositoryRefreshInFlight = true;
  return true;
}

export function finishManualRepositoryRefresh(): void {
  manualRepositoryRefreshInFlight = false;
}

export function resetManualRepositoryRefreshForTests(): void {
  lastManualRepositoryRefreshStartedAt = 0;
  manualRepositoryRefreshInFlight = false;
}
