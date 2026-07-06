// Browser stand-in for @tauri-apps/plugin-fs. The canvas engine only touches
// the filesystem on side paths (log persistence, exports); on the website
// writes vanish and reads report nothing on disk.
export enum BaseDirectory {
  Audio = 1,
  Cache = 2,
  Config = 3,
  Data = 4,
  LocalData = 5,
  Document = 6,
  Download = 7,
  Picture = 8,
  Public = 9,
  Video = 10,
  Resource = 11,
  Temp = 12,
  AppConfig = 13,
  AppData = 14,
  AppLocalData = 15,
  AppCache = 16,
  AppLog = 17,
  Desktop = 18,
  Executable = 19,
  Font = 20,
  Home = 21,
  Runtime = 22,
  Template = 23,
}

export async function exists(): Promise<boolean> {
  return false;
}

export async function mkdir(): Promise<void> {}

export async function readTextFile(): Promise<string> {
  throw new Error('fs is unavailable in the browser');
}

export async function readFile(): Promise<Uint8Array> {
  throw new Error('fs is unavailable in the browser');
}

export async function writeTextFile(): Promise<void> {}

export async function writeFile(): Promise<void> {}

export async function remove(): Promise<void> {}

export async function rename(): Promise<void> {}

export async function copyFile(): Promise<void> {}

export async function readDir(): Promise<unknown[]> {
  return [];
}

export async function stat(): Promise<never> {
  throw new Error('fs is unavailable in the browser');
}

export async function lstat(): Promise<never> {
  throw new Error('fs is unavailable in the browser');
}
