import type { Platform } from './types';

export type * from './types';

let platform: Platform | null = null;

/** Install the host platform. Called once at bootstrap, before render. */
export function setPlatform(next: Platform): void {
  platform = next;
}

/**
 * The installed platform. Read at call time — never snapshot the result at
 * module scope, or a module imported before {@link setPlatform} runs would
 * capture nothing.
 */
export function getPlatform(): Platform {
  if (!platform) {
    throw new Error('Platform not initialized — setPlatform() must run first');
  }
  return platform;
}

/** Whether {@link setPlatform} has run. For pre-bootstrap paths (the logger). */
export function isPlatformSet(): boolean {
  return platform !== null;
}
