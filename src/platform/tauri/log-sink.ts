import {
  BaseDirectory,
  exists,
  readTextFile,
  stat,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { ensureDirOnce, resetFsCacheForTests } from './fs-cache';

const LOGS_DIR = 'logs';
const LOG_FILE = `${LOGS_DIR}/app.log`;
const MAX_FILE_BYTES = 512 * 1024;

// Tracked here so a flush appends instead of reading and rewriting the whole capped file, which
// cost ~1MB of IPC per log call. `null` until the first flush stats the file.
let fileBytes: number | null = null;

function trimLogText(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= maxBytes) {
    return text;
  }

  const tailBytes = bytes.slice(bytes.byteLength - maxBytes);
  let trimmed = decoder.decode(tailBytes);
  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline !== -1) {
    trimmed = trimmed.slice(firstNewline + 1);
  }
  return trimmed;
}

/** Append serialized log lines to the size-capped app log file. */
export async function writeLogs(
  lines: string[],
  maxFileBytes: number = MAX_FILE_BYTES,
): Promise<void> {
  await ensureDirOnce(LOGS_DIR);
  const options = { baseDir: BaseDirectory.AppData };
  const chunk = `${lines.join('\n')}\n`;
  const chunkBytes = new TextEncoder().encode(chunk).byteLength;
  fileBytes ??= (await exists(LOG_FILE, options))
    ? (await stat(LOG_FILE, options)).size
    : 0;
  if (fileBytes + chunkBytes <= maxFileBytes) {
    await writeTextFile(LOG_FILE, chunk, { ...options, append: true });
    fileBytes += chunkBytes;
    return;
  }

  const existing = fileBytes > 0 ? await readTextFile(LOG_FILE, options) : '';
  // Half the cap leaves room for many appends before the next rewrite.
  const next = trimLogText(`${existing}${chunk}`, maxFileBytes / 2);
  await writeTextFile(LOG_FILE, next, options);
  fileBytes = new TextEncoder().encode(next).byteLength;
}

export function getLogFilePath(): string {
  return LOG_FILE;
}

export function resetLogSinkForTests(): void {
  fileBytes = null;
  resetFsCacheForTests();
}
