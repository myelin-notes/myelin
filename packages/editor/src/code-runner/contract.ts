export const RUNNABLE_LANGUAGES = [
  'python',
  'javascript',
  'typescript',
  'ruby',
  'bash',
  'go',
  'rust',
  'c',
  'cpp',
] as const;

export type RunnableLanguage = (typeof RUNNABLE_LANGUAGES)[number];

const LANGUAGE_ALIASES: Record<string, RunnableLanguage> = {
  python: 'python',
  py: 'python',
  javascript: 'javascript',
  js: 'javascript',
  node: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  ruby: 'ruby',
  rb: 'ruby',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  go: 'go',
  golang: 'go',
  rust: 'rust',
  rs: 'rust',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
};

/**
 * Normalizes a fence info token (and common aliases) to a canonical runnable
 * language, or null if the language has no local runner. This is the sole place
 * aliases are resolved; the backend (`resolve_plan` in
 * src-tauri/src/code_runner/runners.rs) only matches these canonical names.
 */
export function canonicalizeLanguage(token: string): RunnableLanguage | null {
  return LANGUAGE_ALIASES[token.trim().toLowerCase()] ?? null;
}

export interface RunCodeRequest {
  executionId: string;
  language: RunnableLanguage;
  source: string;
}

export interface RunOutputEvent {
  executionId: string;
  stream: 'stdout' | 'stderr';
  /** A coalesced batch of output lines (the backend batches to spare IPC). */
  lines: string[];
}

export interface RunFinishedEvent {
  executionId: string;
  exitCode: number | null;
  error: string | null;
}

/**
 * MIME types a run can emit as rich output. Anything else the backend produces
 * is treated as plain text.
 */
export const DISPLAY_MIMES = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'text/html',
  'text/latex',
] as const;

export type DisplayMime = (typeof DISPLAY_MIMES)[number];

export interface DisplayPayload {
  mime: DisplayMime;
  /** Base64 for image mimes, the raw source for text ones. */
  data: string;
}

// Sentinel wrapping a rich-output payload on stdout. Deliberately OSC-shaped:
// it cannot plausibly collide with real program output, and stays inert if it
// ever reaches a real terminal. Emitted by `_emit` in
// src-tauri/src/code_runner/python_boot.py.
const DISPLAY_START = '\u001b]myelin-display;';
const DISPLAY_END = '\u0007';

const isDisplayMime = (value: unknown): value is DisplayMime =>
  DISPLAY_MIMES.includes(value as DisplayMime);

/**
 * Reads a rich-output payload out of one output line, or returns null if the
 * line is ordinary text. A malformed payload is treated as text rather than
 * dropped, so nothing a program prints can silently vanish.
 */
export function parseDisplayPayload(line: string): DisplayPayload | null {
  if (!line.startsWith(DISPLAY_START) || !line.endsWith(DISPLAY_END)) {
    return null;
  }
  const json = line.slice(DISPLAY_START.length, -DISPLAY_END.length);
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'mime' in parsed &&
      'data' in parsed &&
      isDisplayMime(parsed.mime) &&
      typeof parsed.data === 'string'
    ) {
      return { mime: parsed.mime, data: parsed.data };
    }
  } catch {
    // Fall through: render the raw line as text.
  }
  return null;
}
