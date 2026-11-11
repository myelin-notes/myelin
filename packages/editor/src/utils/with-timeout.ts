/** Rejects if `promise` hasn't settled after `ms`. A late result or rejection is dropped. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          reject(new Error(`Timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}
