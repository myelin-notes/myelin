import { isPlatformSet, setPlatform } from '@myelin/editor/platform';

/**
 * Minimal browser implementation of the editor's host-platform seam. The app
 * installs a Tauri platform at bootstrap; the website must install one too or
 * any engine path that calls getPlatform() (page frames, export menus,
 * thumbnails) throws. Only the required primitives are provided; optional
 * capabilities (transcription, code runner, PDF export...) stay absent, which
 * is the supported way to mark them unavailable.
 */
export function initWebPlatform(): void {
  if (isPlatformSet()) {
    return;
  }

  const objectUrls = new Map<string, string>();

  setPlatform({
    async saveFile({ suggestedName, data }) {
      const resolved = await data;
      const blob = new Blob([resolved as BlobPart]);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = suggestedName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return { cancelled: false };
    },

    async openExternal(url) {
      window.open(url, '_blank', 'noopener');
    },

    fetch: (input, init) => fetch(input, init),

    artifactCache: {
      async getUrl(path) {
        return objectUrls.get(path) ?? null;
      },
      async write(path, data) {
        const previous = objectUrls.get(path);
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        objectUrls.set(path, URL.createObjectURL(data));
      },
      async remove(path) {
        for (const [key, url] of objectUrls) {
          if (key === path || key.startsWith(`${path}/`)) {
            URL.revokeObjectURL(url);
            objectUrls.delete(key);
          }
        }
      },
    },

    async subscribeEvent() {
      return () => {};
    },
  });
}
