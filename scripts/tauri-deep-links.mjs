#!/usr/bin/env node
// CLI tool to inspect and clear macOS deep link URL scheme routing.
//
// Tauri's deep-link plugin registers macOS schemes through the bundled app's
// Info.plist. macOS keeps those app registrations in LaunchServices, so stale
// build paths can keep handling links after bundles move or get deleted.
//
// Usage:
//   yarn tauri:mac-deep-links:check
//   yarn tauri:mac-deep-links:clear
//   node scripts/tauri-deep-links.mjs raw
//   node scripts/tauri-deep-links.mjs check <scheme>

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LSREGISTER_PATH =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

const LS_PREFS_PATH = path.join(
  process.env.HOME ?? '',
  'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist',
);

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const tauriConfig = readTauriConfig();
const configuredProtocols = getConfiguredDesktopProtocols();

const command = process.argv[2] ?? 'check';
const protocol = process.argv[3] ?? getDefaultProtocol();

if (!['check', 'clear', 'raw'].includes(command)) {
  console.error(
    `Unknown command "${command}". Use "check", "clear", or "raw".`,
  );
  process.exit(1);
}

if (!isValidProtocol(protocol)) {
  console.error(`Invalid protocol scheme: "${protocol}"`);
  process.exit(1);
}

if (process.platform !== 'darwin') {
  console.error(
    `This script only supports macOS (received ${process.platform}).`,
  );
  process.exit(1);
}

console.log('Reading LaunchServices database...');

let dumpOutput = '';
try {
  dumpOutput = execFileSync(LSREGISTER_PATH, ['-dump'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
} catch (error) {
  console.error('Failed to read LaunchServices registrations:', error);
  process.exit(1);
}

if (command === 'raw') {
  console.log(dumpOutput);
  process.exit(0);
}

const dumpEntries = parseDumpEntries(dumpOutput);
dumpOutput = '';

if (command === 'check') {
  check();
  process.exit(0);
}

clear();

function check() {
  const defaultHandler = getDefaultHandler();
  const preferenceHandlers = getPreferenceHandlers();
  const bundleRegistrations = getBundleRegistrations();

  printConfiguredProtocolNote();

  console.log();
  console.log(`${protocol}:// deep links currently route to:`);
  console.log(`  ${defaultHandler ?? '(no handler registered)'}`);

  if (preferenceHandlers.length > 0) {
    console.log();
    console.log('Preference-level handlers:');
    console.table(
      preferenceHandlers.map((handler) => ({
        LSHandlerRoleAll: handler.LSHandlerRoleAll ?? '(unknown)',
      })),
    );

    const appRegistrations = getAppsByBundleIds(
      preferenceHandlers
        .map((handler) => handler.LSHandlerRoleAll)
        .filter((bundleId) => typeof bundleId === 'string'),
    );

    if (appRegistrations.length > 0) {
      console.log();
      console.log('Apps matching those bundle IDs:');
      console.table(
        appRegistrations.sort(byAppPath).map((entry) => ({
          'App Path': entry.appPath,
          CFBundleIdentifier: entry.bundleIdentifier ?? '(unknown)',
        })),
      );
    }
  }

  console.log();
  if (bundleRegistrations.length === 0) {
    console.log(`No apps declare ${protocol}:// in their Info.plist.`);
  } else {
    console.log(
      `${bundleRegistrations.length} ${pluralize(
        bundleRegistrations.length,
        'app declares',
        'apps declare',
      )} ${protocol}:// in their Info.plist:`,
    );
    console.log();
    console.table(
      bundleRegistrations.sort(byAppPath).map((entry) => ({
        'App Path': entry.appPath,
        CFBundleIdentifier: entry.bundleIdentifier ?? '(unknown)',
      })),
    );
  }

  if (preferenceHandlers.length > 0 || bundleRegistrations.length > 0) {
    console.log();
    console.log(
      'Run this script with "clear" to remove these macOS registrations.',
    );
  }
}

function clear() {
  let clearedAny = false;
  const preferenceHandlers = getPreferenceHandlers();

  if (preferenceHandlers.length > 0) {
    console.log();
    console.log(`Clearing preference-level handlers for ${protocol}://`);
    const result = clearPreferenceHandlers();

    if (result.failed.length > 0) {
      console.error(`Failed to remove indexes: ${result.failed.join(', ')}`);
      process.exit(1);
    }

    console.log(`  Removed ${result.removed.length}.`);
    clearedAny = result.removed.length > 0;

    const appRegistrations = getAppsByBundleIds(
      preferenceHandlers
        .map((handler) => handler.LSHandlerRoleAll)
        .filter((bundleId) => typeof bundleId === 'string'),
    );

    if (appRegistrations.length > 0) {
      console.log();
      console.log(
        `Unregistering ${appRegistrations.length} apps matching preference handler bundle IDs:`,
      );
      console.log();
      const results = unregisterApps(
        appRegistrations.map((entry) => entry.appPath),
      );
      printUnregisterResults(results);
      clearedAny = true;
    }
  }

  const bundleRegistrations = getBundleRegistrations();
  if (bundleRegistrations.length > 0) {
    console.log();
    console.log(
      `Clearing bundle-level registrations for ${protocol}:// (${bundleRegistrations.length} found)`,
    );
    console.log();

    const results = unregisterApps(
      bundleRegistrations.map((entry) => entry.appPath),
    );
    printUnregisterResults(results);
    clearedAny = true;
  }

  if (!clearedAny) {
    console.log(`No registrations to clear for ${protocol}://`);
    return;
  }

  console.log();
  console.log('Updated state:');
  console.log(`Default handler is now: ${getDefaultHandler() ?? '(none)'}`);
}

function parseDumpEntries(dumpText) {
  const blocks = dumpText.split(/(?=^path:\s)/m);
  const entries = [];

  for (const block of blocks) {
    const pathMatch = block.match(/^path:\s+(.+?)\s+\(0x[0-9a-f]+\)/i);
    if (!pathMatch) {
      continue;
    }

    const identifierMatch = block.match(
      /^identifier:\s+(.+?)\s+\(0x[0-9a-f]+\)/im,
    );
    const bundleMatch = block.match(/CFBundleIdentifier\s*=\s*"([^"]+)"/);
    const schemesMatch = block.match(/^claimed schemes:\s+(.+)$/im);

    entries.push({
      appPath: pathMatch[1].trim(),
      identifier: identifierMatch?.[1]?.trim() ?? null,
      bundleIdentifier: bundleMatch?.[1]?.trim() ?? null,
      claimedSchemes: schemesMatch?.[1]?.toLowerCase().split(/\s+/) ?? [],
    });
  }

  return entries;
}

function getDefaultHandler() {
  try {
    const result = execFileSync(
      'osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        `ObjC.import('AppKit'); try { $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString('${protocol}:')).path.js } catch(e) { '' }`,
      ],
      { encoding: 'utf8' },
    ).trim();

    return result || null;
  } catch (error) {
    console.error('Failed to query default handler:', error);
    return null;
  }
}

function readLSHandlers() {
  if (!fs.existsSync(LS_PREFS_PATH)) {
    return [];
  }

  try {
    const json = execFileSync(
      'plutil',
      ['-extract', 'LSHandlers', 'json', '-o', '-', LS_PREFS_PATH],
      { encoding: 'utf8' },
    );
    const handlers = JSON.parse(json);
    return Array.isArray(handlers) ? handlers : [];
  } catch {
    return [];
  }
}

function getPreferenceHandlers() {
  return readLSHandlers().filter(
    (handler) =>
      typeof handler.LSHandlerURLScheme === 'string' &&
      handler.LSHandlerURLScheme.toLowerCase() === protocol.toLowerCase(),
  );
}

function getAppsByBundleIds(bundleIds) {
  const loweredBundleIds = new Set(
    bundleIds.map((bundleId) => bundleId.toLowerCase()),
  );

  return uniqueEntries(
    dumpEntries.filter((entry) =>
      loweredBundleIds.has(entry.bundleIdentifier?.toLowerCase()),
    ),
  );
}

function getBundleRegistrations() {
  const scheme = `${protocol.toLowerCase()}:`;
  return dumpEntries.filter((entry) => entry.claimedSchemes.includes(scheme));
}

function clearPreferenceHandlers() {
  const handlers = readLSHandlers();
  const indexes = handlers
    .map((handler, index) => ({ handler, index }))
    .filter(
      ({ handler }) =>
        typeof handler.LSHandlerURLScheme === 'string' &&
        handler.LSHandlerURLScheme.toLowerCase() === protocol.toLowerCase(),
    )
    .map(({ index }) => index)
    .sort((a, b) => b - a);

  const removed = [];
  const failed = [];

  for (const index of indexes) {
    try {
      execFileSync(
        'plutil',
        ['-remove', `LSHandlers.${index}`, LS_PREFS_PATH],
        {
          encoding: 'utf8',
        },
      );
      removed.push(index);
    } catch {
      failed.push(index);
    }
  }

  return { removed, failed };
}

function unregisterApps(appPaths) {
  return [...new Set(appPaths)].map((appPath) => {
    try {
      execFileSync(LSREGISTER_PATH, ['-u', appPath], { encoding: 'utf8' });
      return { appPath, result: 'Removed', details: '' };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown unregister error';

      if (message.includes('-10814')) {
        return { appPath, result: 'Unavailable', details: '' };
      }

      return { appPath, result: 'Failed', details: message };
    }
  });
}

function printUnregisterResults(results) {
  const sortedResults = results.sort(byAppPath);
  console.table(
    sortedResults.map((result) => ({
      'App Path': result.appPath,
      Result: result.result,
      ...(result.details ? { Details: result.details } : {}),
    })),
  );

  const unavailable = sortedResults.filter(
    (result) => result.result === 'Unavailable',
  );
  const failed = sortedResults.filter((result) => result.result === 'Failed');
  const removed = sortedResults.length - unavailable.length - failed.length;

  console.log(`${removed}/${sortedResults.length} unregistered.`);

  if (unavailable.length > 0) {
    console.log(
      `${unavailable.length} tied to unavailable apps; macOS cannot route to them.`,
    );
  }

  if (failed.length > 0) {
    console.error(`${failed.length} failed. Some handlers may remain.`);
    process.exit(1);
  }
}

function readTauriConfig() {
  try {
    return JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
  } catch (error) {
    console.error(`Failed to read ${tauriConfigPath}:`, error);
    return {};
  }
}

function getConfiguredDesktopProtocols() {
  const schemes = tauriConfig?.plugins?.['deep-link']?.desktop?.schemes;

  if (!Array.isArray(schemes)) {
    return [];
  }

  return schemes.filter(
    (scheme) => typeof scheme === 'string' && scheme.trim().length > 0,
  );
}

function getDefaultProtocol() {
  const configuredProtocol = configuredProtocols[0];

  if (configuredProtocol) {
    return configuredProtocol;
  }

  const productName = tauriConfig?.productName;
  if (typeof productName !== 'string') {
    return 'myelin';
  }

  const normalized = productName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+.-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return isValidProtocol(normalized) ? normalized : 'myelin';
}

function printConfiguredProtocolNote() {
  const relativeConfigPath = path.relative(rootDir, tauriConfigPath);

  if (configuredProtocols.length === 0) {
    console.log(
      `No Tauri desktop deep-link schemes are configured in ${relativeConfigPath}; checking ${protocol}://.`,
    );
    return;
  }

  if (!configuredProtocols.includes(protocol)) {
    console.log(
      `${protocol}:// is not listed in ${relativeConfigPath}. Configured schemes: ${configuredProtocols.join(
        ', ',
      )}`,
    );
  }
}

function isValidProtocol(value) {
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*$/.test(value);
}

function uniqueEntries(entries) {
  const seen = new Set();
  const unique = [];

  for (const entry of entries) {
    const key = `${entry.appPath}\0${entry.bundleIdentifier ?? ''}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(entry);
  }

  return unique;
}

function byAppPath(a, b) {
  return a.appPath.localeCompare(b.appPath);
}

function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural;
}
