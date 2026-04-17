// pdf.js v5.6 calls `Map.prototype.getOrInsertComputed`, a TC39 Stage 3
// proposal not yet shipped in WebKit. Tauri uses WKWebView on macOS, so
// we install the polyfill for both the main thread and the worker.
type Computed<K, V> = (key: K) => V;

interface MapWithGetOrInsertComputed<K, V> {
  getOrInsertComputed(key: K, cb: Computed<K, V>): V;
}

const proto = Map.prototype as unknown as MapWithGetOrInsertComputed<
  unknown,
  unknown
>;

if (typeof proto.getOrInsertComputed !== 'function') {
  proto.getOrInsertComputed = function (this: Map<unknown, unknown>, key, cb) {
    if (this.has(key)) {
      return this.get(key);
    }
    const value = cb(key);
    this.set(key, value);
    return value;
  };
}

// WKWebView (Tauri on macOS) doesn't expose [Symbol.asyncIterator] on
// ReadableStream. pdf.js uses `for await (const chunk of stream)` in
// getTextContent / getOperatorList, so we polyfill it via getReader().
const rsProto = ReadableStream.prototype as unknown as Record<symbol, unknown>;
if (typeof rsProto[Symbol.asyncIterator] !== 'function') {
  rsProto[Symbol.asyncIterator] = function (this: ReadableStream) {
    const reader = this.getReader();
    return {
      next() {
        return reader.read() as Promise<IteratorResult<unknown, unknown>>;
      },
      return(value: unknown) {
        reader.releaseLock();
        return Promise.resolve({ value, done: true });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}
