import { type DocumentRequest, processDocument } from './document-processing';

self.onmessage = (
  event: MessageEvent<{ id: number; request: DocumentRequest }>,
) => {
  const { id, request } = event.data;
  try {
    const result = processDocument(request);
    const buffers: Transferable[] = [result.stateVector.buffer];
    if (result.update) {
      buffers.push(result.update.buffer);
    }
    self.postMessage({ id, result }, { transfer: buffers });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
