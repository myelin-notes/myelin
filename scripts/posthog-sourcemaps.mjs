// Upload the production build's source maps to PostHog (so the exceptions
// captured by posthog-js — see src/lib/posthog.ts — symbolicate back to
// original source instead of minified bundle output), then strip the maps so
// they never ship inside the app bundle.
//
// This runs at the tail of `yarn build`, which Tauri invokes as its
// beforeBuildCommand. The inject step rewrites the emitted .js so each file
// carries a `//# chunkId=` marker; that injected JS is what Tauri then bundles
// into the app, and PostHog matches the uploaded maps to it by chunk ID. So
// this has to happen here, before bundling — not as a later CI step.
//
// Uploading only happens when POSTHOG_CLI_API_KEY is set (CI release builds);
// local and dev builds skip it. The map stripping always happens, so no build
// — release or local — ever ships .map files to end users.
//
// Required env for upload (see
// https://posthog.com/docs/error-tracking/upload-source-maps):
//   POSTHOG_CLI_API_KEY    personal API key (error tracking write + org read)
//   POSTHOG_CLI_PROJECT_ID numeric PostHog project id
//   POSTHOG_CLI_HOST       instance url, e.g. https://us.posthog.com

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DIST_DIR = 'dist';
// Pinned so CI is reproducible; bump deliberately.
const CLI = '@posthog/cli@0.7.33';

function cli(...args) {
  // shell:true lets Node resolve npx -> npx.cmd on Windows runners. Safe here:
  // none of the args contain spaces or shell metacharacters.
  execFileSync('npx', ['--yes', CLI, ...args], {
    stdio: 'inherit',
    shell: true,
  });
}

if (process.env.POSTHOG_CLI_API_KEY) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

  console.log('[posthog-sourcemaps] Injecting chunk IDs into', DIST_DIR);
  cli('sourcemap', 'inject', '--directory', DIST_DIR);

  console.log(
    `[posthog-sourcemaps] Uploading source maps for myelin@${version}`,
  );
  cli(
    'sourcemap',
    'upload',
    '--directory',
    DIST_DIR,
    '--release-name',
    'myelin',
    '--release-version',
    version,
  );
} else {
  console.log(
    '[posthog-sourcemaps] POSTHOG_CLI_API_KEY not set — skipping source map upload.',
  );
}

// Always strip maps so they never ship inside the app bundle (smaller bundle,
// source not exposed to end users). When the upload ran, the maps already live
// in PostHog; otherwise they're simply discarded.
const maps = readdirSync(DIST_DIR, { recursive: true }).filter((f) =>
  String(f).endsWith('.map'),
);
for (const map of maps) {
  rmSync(join(DIST_DIR, String(map)));
}
console.log(
  `[posthog-sourcemaps] Removed ${maps.length} .map file(s) from the bundle.`,
);
