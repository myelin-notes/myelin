/**
 * Destinations and platform identity: the parts of the content layer that carry
 * no words and so never vary by language.
 *
 * Kept out of `./index` deliberately. That barrel pulls in every locale's full
 * catalog, and the static page's download script needs only these constants;
 * importing it there would ship all three catalogs to the mobile visitors who
 * get the static rendering. Import from here in anything that runs client-side.
 */

export const siteLinks = {
  releases: 'https://github.com/myelin-notes/myelin/releases/latest',
  /** Latest stable release, as JSON: where `src/lib/downloads.ts` finds the
   *  per-platform installer asset behind every download button. */
  latestReleaseApi:
    'https://api.github.com/repos/myelin-notes/myelin/releases/latest',
  license: 'https://github.com/myelin-notes/myelin/blob/main/LICENSE.md',
};

/** Every platform Myelin ships a native build for. */
export type PlatformKey = 'mac' | 'windows' | 'linux' | 'ios' | 'android';

export interface Platform {
  key: PlatformKey;
  /** Bare platform, for lists where repeating "Download for" would grate. */
  name: string;
  /** Full call to action, for wherever a platform stands on its own. */
  label: string;
  /** Minimum version or artifact kind. */
  sub: string;
}
