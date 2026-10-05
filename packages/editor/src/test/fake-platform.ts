import type { Platform } from '../platform';

/**
 * A minimal in-memory {@link Platform} for tests. Required primitives are
 * inert no-ops; capabilities are absent so
 * capability-gated affordances default to hidden. Pass overrides (or call
 * `setPlatform` with a customized fake) to exercise a specific seam.
 */
export function createFakePlatform(
  overrides: Partial<Platform> = {},
): Platform {
  return {
    saveFile: async () => ({ cancelled: true }),
    openExternal: async () => {},
    fetch: async () => {
      throw new Error('platform.fetch is not faked in this test');
    },
    artifactCache: {
      getUrl: async () => null,
      read: async () => null,
      write: async () => {},
      remove: async () => {},
    },
    subscribeEvent: async () => () => {},
    ...overrides,
  };
}
