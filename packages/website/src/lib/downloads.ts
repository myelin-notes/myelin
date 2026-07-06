// Resolve the desktop download links to direct CDN installer URLs for the
// current stable release. The updater manifest is the single source of truth
// for the live version, so nothing is hardcoded here and no rebuild is needed
// when a release ships. Windows (-setup.exe) and Linux (.AppImage) installers
// are updater artifacts and used verbatim; the macOS .dmg isn't, so it's
// derived from the manifest's version folder (uploaded there as
// Myelin-macOS.dmg by promote-release.mjs).
import { trackWebEvent } from './posthog';

const MANIFEST = 'https://updates.trymyelin.app/stable/latest.json';

export type DesktopPlatform = 'macOS' | 'Windows' | 'Linux';

export type ResolvedDownloads = Partial<Record<DesktopPlatform, string>>;

let resolved: Promise<ResolvedDownloads> | null = null;

export function resolveDownloadUrls(): Promise<ResolvedDownloads> {
  resolved ??= (async () => {
    let manifest: {
      platforms?: Record<string, { url?: string }>;
    };
    try {
      const res = await fetch(MANIFEST, { cache: 'no-store' });
      if (!res.ok) {
        return {};
      }
      manifest = await res.json();
    } catch {
      return {};
    }
    const platforms = manifest.platforms ?? {};
    // The macOS .dmg lives beside the darwin updater bundle in the same
    // version folder, so derive its URL from that bundle's URL.
    const darwinUrl = platforms['darwin-aarch64']?.url;
    const versionBase = darwinUrl?.slice(0, darwinUrl.lastIndexOf('/') + 1);

    return {
      macOS: versionBase ? `${versionBase}Myelin-macOS.dmg` : undefined,
      Windows: platforms['windows-x86_64']?.url,
      Linux: platforms['linux-x86_64']?.url,
    };
  })();
  return resolved;
}

export function trackDownloadClick(platform: string): void {
  trackWebEvent('download_clicked', { platform });
}

/**
 * Point every `[data-download-platform]` element under `root` at its
 * resolved installer URL and report clicks. Elements stay inert until the
 * manifest answers.
 */
export function wireDownloadLinks(root: ParentNode): void {
  const links = root.querySelectorAll<HTMLElement>('[data-download-platform]');
  for (const el of links) {
    el.addEventListener('click', () => {
      trackDownloadClick(el.dataset.downloadPlatform ?? 'unknown');
    });
  }
  resolveDownloadUrls().then((hrefFor) => {
    for (const el of links) {
      const href = hrefFor[el.dataset.downloadPlatform as DesktopPlatform];
      if (href) {
        el.setAttribute('href', href);
      }
    }
  });
}
