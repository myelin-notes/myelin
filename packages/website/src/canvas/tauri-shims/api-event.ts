// Browser stand-in for @tauri-apps/api/event: no backend, so no events ever
// arrive and emits go nowhere.
export type UnlistenFn = () => void;

export interface Event<T> {
  event: string;
  id: number;
  payload: T;
}

export type EventCallback<T> = (event: Event<T>) => void;

export async function listen<T>(
  _event: string,
  _handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return () => {};
}

export async function once<T>(
  _event: string,
  _handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return () => {};
}

export async function emit(): Promise<void> {}
