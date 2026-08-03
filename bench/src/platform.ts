import { setPlatform } from '@myelin/editor/platform';

/**
 * The narrowest host-platform seam the engine will start against.
 *
 * `DrawableCanvas` and anything it hydrates call `getPlatform()`, which throws
 * when nothing is installed. The bench never saves, opens, or fetches — but a
 * capability that is present and wrong would silently change what is measured,
 * so every method here either does nothing or rejects loudly. Optional
 * capabilities (transcription, code runner, PDF export) stay absent, which is
 * the supported way to mark them unavailable.
 */
export function initBenchPlatform(): void {
  setPlatform({
    async saveFile() {
      throw new Error('bench platform: saveFile is not available');
    },
    async openExternal() {
      throw new Error('bench platform: openExternal is not available');
    },
    fetch: (input, init) => fetch(input, init),
    artifactCache: {
      async getUrl() {
        return null;
      },
      async write() {},
      async remove() {},
    },
    async subscribeEvent() {
      return () => {};
    },
  });
}
