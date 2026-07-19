import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { ensureDirOnce, resetFsCacheForTests } from './fs-cache';

const LOGS_DIR = 'logs';
const LOG_FILE = `${LOGS_DIR}/app.log`;
const MAX_FILE_BYTES = 512 * 1024;

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
  const existing = (await exists(LOG_FILE, { baseDir: BaseDirectory.AppData }))
    ? await readTextFile(LOG_FILE, { baseDir: BaseDirectory.AppData })
    : '';
  const next = trimLogText(`${existing}${lines.join('\n')}\n`, maxFileBytes);
  await writeTextFile(LOG_FILE, next, { baseDir: BaseDirectory.AppData });
}

export function getLogFilePath(): string {
  return LOG_FILE;
}

export function resetLogSinkForTests(): void {
  resetFsCacheForTests();
}
