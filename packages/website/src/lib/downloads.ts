import { type PlatformKey, siteLinks } from '@/content/site/links';

/**
 * Best guess at the visitor's platform, so the primary download button offers
 * the build they can actually run. Order is load-bearing: Android reports
 * itself as "Linux; Android", and iPadOS 13+ sends a desktop Macintosh user
 * agent, which touch points are the only reliable tell for.
 */
export function detectPlatform(): PlatformKey {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return 'ios';
  }
  if (/Android/i.test(ua)) {
    return 'android';
  }
  if (/Mac/i.test(ua)) {
    return navigator.maxTouchPoints > 1 ? 'ios' : 'mac';
  }
  if (/Linux/i.test(ua)) {
    return 'linux';
  }
  return 'windows';
}

/** Filename suffix that identifies each platform's installer, lowercased. */
const INSTALLER_SUFFIX: Record<PlatformKey, string> = {
  mac: '.dmg',
  windows: '-setup.exe',
  linux: '.appimage',
  ios: '.ipa',
  android: '.apk',
};

export type DownloadUrls = Partial<Record<PlatformKey, string>>;

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

let pending: Promise<DownloadUrls> | undefined;

/**
 * Direct installer URLs for the latest stable release, keyed by platform.
 *
 * Release assets carry the version in their filename
 * ("Myelin.Notes_0.2.3_x64-setup.exe"), so there is no fixed
 * `/releases/latest/download/<name>` URL a page could hardcode: the real names
 * have to come from the API. Platforms with no asset in the release are absent
 * from the result, as is everything if the request fails, so callers keep the
 * releases page as the href they start from. Resolved once per page load.
 */
export function fetchDownloadUrls(): Promise<DownloadUrls> {
  pending ??= loadDownloadUrls();
  return pending;
}

async function loadDownloadUrls(): Promise<DownloadUrls> {
  try {
    const response = await fetch(siteLinks.latestReleaseApi, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      return {};
    }
    const release = (await response.json()) as { assets?: ReleaseAsset[] };
    const urls: DownloadUrls = {};
    for (const asset of release.assets ?? []) {
      const name = asset.name.toLowerCase();
      for (const key of Object.keys(INSTALLER_SUFFIX) as PlatformKey[]) {
        if (name.endsWith(INSTALLER_SUFFIX[key])) {
          urls[key] = asset.browser_download_url;
        }
      }
    }
    return urls;
  } catch {
    return {};
  }
}

/** Platforms with a build, in the order the copy lists them. */
const FALLTHROUGH: readonly PlatformKey[] = ['mac', 'windows', 'linux'];

/**
 * Installer for the visitor's own platform, falling through to the first
 * platform that does have one. The release ships no `.ipa`, so without this an
 * iPhone visitor is left on the releases page. Matches how the canvas overlay
 * picks its `primary` platform.
 */
export function autoDownloadUrl(
  urls: DownloadUrls,
  detected: PlatformKey,
): string | undefined {
  return urls[detected] ?? FALLTHROUGH.map((key) => urls[key]).find(Boolean);
}
