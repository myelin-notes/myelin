import {
  type NoteSearchDocument,
  NoteSearchEngine,
} from './note-search-engine';

const engine = new NoteSearchEngine();

self.onmessage = (
  event: MessageEvent<
    | { type: 'nodes'; nodes: NoteSearchDocument[] }
    | { type: 'remove'; ids: string[] }
    | { type: 'content'; id: string; content: string }
    | { type: 'search'; requestId: number; query: string; limit?: number }
  >,
) => {
  const message = event.data;
  switch (message.type) {
    case 'nodes':
      for (const node of message.nodes) {
        engine.upsert({
          ...node,
          content: engine.get(node.id)?.content ?? node.content,
        });
      }
      break;
    case 'remove':
      for (const id of message.ids) {
        engine.remove(id);
      }
      break;
    case 'content': {
      const node = engine.get(message.id);
      if (node) {
        engine.upsert({ ...node, content: message.content });
      }
      break;
    }
    case 'search':
      self.postMessage({
        requestId: message.requestId,
        hits: engine.search(message.query, message.limit),
      });
      break;
  }
};
