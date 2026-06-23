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

export interface RunOutputEvent {
  executionId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface RunFinishedEvent {
  executionId: string;
  exitCode: number | null;
  error: string | null;
}
