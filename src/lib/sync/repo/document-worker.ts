import {
  type DocumentRequest,
  type DocumentResult,
  processDocument,
} from './document-processing';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  {
    resolve: (result: DocumentResult) => void;
    reject: (error: Error) => void;
  }
>();

/** Repository snapshots are decoded off the drawing thread; callers retain their input buffers. */
export function processDocumentAsync(
  request: DocumentRequest,
): Promise<DocumentResult> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve().then(() => processDocument(request));
  }
  if (!worker) {
    worker = new Worker(new URL('./document.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (
      event: MessageEvent<{
        id: number;
        result: DocumentResult;
        error?: string;
      }>,
    ) => {
      const job = pending.get(event.data.id);
      if (!job) {
        return;
      }
      pending.delete(event.data.id);
      if (event.data.error !== undefined) {
        job.reject(new Error(event.data.error));
      } else {
        job.resolve(event.data.result);
      }
    };
    worker.onerror = (event) => {
      worker?.terminate();
      worker = null;
      for (const job of pending.values()) {
        job.reject(new Error(event.message));
      }
      pending.clear();
    };
  }
  const activeWorker = worker;
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try {
      activeWorker.postMessage({ id, request });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}
