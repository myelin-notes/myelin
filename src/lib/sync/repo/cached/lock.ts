interface AsyncKeyedMutexState {
  active: boolean;
  waiters: Array<() => void>;
}

const asyncKeyedMutexes = new Map<string, AsyncKeyedMutexState>();

// Serializes async critical sections that share a key. This guards await
// interleavings; it is not a thread lock.
export async function withAsyncKeyedMutex<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  let state = asyncKeyedMutexes.get(key);
  if (!state) {
    state = {
      active: false,
      waiters: [],
    };
    asyncKeyedMutexes.set(key, state);
  }

  if (state.active) {
    await new Promise<void>((resolve) => {
      state.waiters.push(resolve);
    });
  }

  state.active = true;

  try {
    return await operation();
  } finally {
    const next = state.waiters.shift();
    if (next) {
      next();
    } else {
      state.active = false;
      asyncKeyedMutexes.delete(key);
    }
  }
}
