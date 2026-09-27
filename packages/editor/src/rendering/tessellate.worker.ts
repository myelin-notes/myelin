import { tessellate } from './tessellate';

interface Request {
  requestId: number;
  contours: Float64Array[];
}

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

worker.onmessage = ({ data }) => {
  const contours = data.contours.map((coords) => {
    const points = [];
    for (let i = 0; i < coords.length; i += 2) {
      points.push({ x: coords[i], y: coords[i + 1] });
    }
    return { points, closed: true };
  });
  const vertices = tessellate(contours);
  const origin = { x: vertices[0] ?? 0, y: vertices[1] ?? 0 };
  const localVertices = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 2) {
    localVertices[i] = vertices[i] - origin.x;
    localVertices[i + 1] = vertices[i + 1] - origin.y;
  }
  worker.postMessage(
    { requestId: data.requestId, vertices: localVertices, origin },
    [localVertices.buffer],
  );
};
