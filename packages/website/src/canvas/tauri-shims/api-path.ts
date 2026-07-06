// Browser stand-in for @tauri-apps/api/path.
export async function appDataDir(): Promise<string> {
  return '/';
}

export async function appLocalDataDir(): Promise<string> {
  return '/';
}

export async function appCacheDir(): Promise<string> {
  return '/';
}

export async function documentDir(): Promise<string> {
  return '/';
}

export async function homeDir(): Promise<string> {
  return '/';
}

export async function join(...parts: string[]): Promise<string> {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

export async function dirname(path: string): Promise<string> {
  const idx = path.replace(/[/\\]+$/, '').lastIndexOf('/');
  return idx > 0 ? path.slice(0, idx) : '/';
}

export async function basename(path: string): Promise<string> {
  return path.split(/[/\\]/).pop() ?? path;
}

export const sep = () => '/';
