// Browser stand-in for @tauri-apps/api/core. `invoke` only backs desktop-only
// commands (exports, indexing); nothing on the website's canvas path calls it.
export async function invoke<T>(cmd: string): Promise<T> {
  throw new Error(`Tauri command "${cmd}" is unavailable in the browser`);
}

export function convertFileSrc(filePath: string): string {
  return filePath;
}

export class Channel<T = unknown> {
  onmessage: (response: T) => void = () => {};
}
