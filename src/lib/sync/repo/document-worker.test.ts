import { afterEach, expect, it, vi } from 'vitest';
import { processDocumentAsync } from './document-worker';

afterEach(() => vi.unstubAllGlobals());

it('routes concurrent worker replies and rejects failed jobs so saves can retry', async () => {
  const postMessage = vi.fn();
  const terminate = vi.fn();
  const instances: Worker[] = [];
  vi.stubGlobal(
    'Worker',
    class {
      postMessage = postMessage;
      terminate = terminate;
      constructor() {
        instances.push(this as unknown as Worker);
      }
    },
  );
  const first = processDocumentAsync({ bytes: null });
  const second = processDocumentAsync({ bytes: new Uint8Array([0, 0]) });
  expect(instances).toHaveLength(1);
  const [firstMessage, secondMessage] = postMessage.mock.calls.map(
    ([message]) => message,
  );
  const result = {
    update: null,
    stateVector: new Uint8Array([0]),
    changed: false,
    links: [],
  };
  instances[0].onmessage!({
    data: { id: secondMessage.id, result },
  } as MessageEvent);
  await expect(second).resolves.toEqual(result);
  instances[0].onmessage!({
    data: { id: firstMessage.id, error: 'Invalid update' },
  } as MessageEvent);
  await expect(first).rejects.toThrow('Invalid update');
  const failed = processDocumentAsync({ bytes: null });
  instances[0].onerror!({ message: 'Worker crashed' } as ErrorEvent);
  await expect(failed).rejects.toThrow('Worker crashed');
  expect(terminate).toHaveBeenCalledOnce();
  const retry = processDocumentAsync({ bytes: null });
  expect(instances).toHaveLength(2);
  const rejected = expect(retry).rejects.toThrow('Worker crashed again');
  instances[1].onerror!({ message: 'Worker crashed again' } as ErrorEvent);
  await rejected;
});
