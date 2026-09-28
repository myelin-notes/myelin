import { getPlatform } from '@myelin/editor/platform';
import type { VFSNodeId } from '@/lib/sync';

const CACHE_PATH = 'viewport-state.json';
const WRITE_DELAY_MS = 250;

export interface ViewportState {
  zoom: number;
  offset: { x: number; y: number };
}

type ViewportStates = Record<string, ViewportState>;

let states: ViewportStates | null = null;
let loading: Promise<ViewportStates> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function isViewportState(value: unknown): value is ViewportState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const state = value as Partial<ViewportState>;
  return (
    typeof state.zoom === 'number' &&
    Number.isFinite(state.zoom) &&
    typeof state.offset?.x === 'number' &&
    Number.isFinite(state.offset.x) &&
    typeof state.offset?.y === 'number' &&
    Number.isFinite(state.offset.y)
  );
}

async function load(): Promise<ViewportStates> {
  if (states) {
    return states;
  }
  loading ??= (async () => {
    try {
      const artifact = await getPlatform().artifactCache.read(CACHE_PATH);
      if (!artifact) {
        return {};
      }
      const parsed: unknown = JSON.parse(await artifact.text());
      if (typeof parsed !== 'object' || parsed === null) {
        return {};
      }
      return Object.fromEntries(
        Object.entries(parsed).filter(([, state]) => isViewportState(state)),
      );
    } catch {
      return {};
    }
  })();
  states = await loading;
  return states;
}

async function write(): Promise<void> {
  const currentStates = await load();
  await getPlatform().artifactCache.write(
    CACHE_PATH,
    new Blob([JSON.stringify(currentStates)], { type: 'application/json' }),
  );
}

function scheduleWrite(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeQueue = writeQueue.then(write, write).catch(() => {});
  }, WRITE_DELAY_MS);
}

export async function readViewportState(
  noteId: VFSNodeId,
): Promise<ViewportState | null> {
  return (await load())[noteId] ?? null;
}

export function saveViewportState(
  noteId: VFSNodeId,
  state: ViewportState,
): void {
  if (!states) {
    return;
  }
  states[noteId] = state;
  scheduleWrite();
}

export async function flushViewportStates(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
    writeQueue = writeQueue.then(write, write).catch(() => {});
  }
  await writeQueue;
}
