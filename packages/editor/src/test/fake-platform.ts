import type {
  HandwritingCapability,
  NoteIndexCapability,
  Platform,
} from '../platform';

/**
 * A minimal in-memory {@link Platform} for tests. Required primitives are
 * inert no-ops; `noteIndex` and `handwriting` are present (repository code
 * exercises them on save), while the remaining capabilities are absent so
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
      write: async () => {},
      remove: async () => {},
    },
    subscribeEvent: async () => () => {},
    noteIndex: createFakeNoteIndex(),
    handwriting: createFakeHandwriting(),
    ...overrides,
  };
}

function createFakeNoteIndex(): NoteIndexCapability {
  return {
    init: async () => {},
    reset: () => {},
    getContent: () => new Map(),
    getEmbeddings: () => new Map(),
    embedSearchQuery: async () => ({ model: 'test', dim: 0, vector: [] }),
    requestReindex: () => {},
    startBackfill: () => {},
    removeIndex: async () => {},
  };
}

function createFakeHandwriting(): HandwritingCapability {
  return {
    init: () => {},
    reset: () => {},
    requestRecognize: () => {},
    startBackfill: () => {},
    readPage: async () => null,
    removeRecognition: async () => {},
  };
}
