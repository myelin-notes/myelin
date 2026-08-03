import { appendFileSync } from 'node:fs';
import path from 'node:path';
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite';

/** Where the page POSTs a finished run. @see src/report.ts */
export const RESULT_ENDPOINT = '/bench-result';

const LOG_FILE = 'device-runs.jsonl';

/** Refuse anything larger than a plausible run; this listens on the LAN. */
const MAX_BODY_BYTES = 256 * 1024;

function readBody(request: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('bench result body too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

/**
 * Accepts finished bench runs from the page and prints them to the terminal
 * that started the server.
 *
 * The measurements that matter are taken on a tablet, which has no terminal and
 * no clipboard worth using across machines. Posting them back means the device
 * only has to load a URL; the results land where the work is being done.
 */
export function resultSink(benchDir: string): Plugin {
  const handler: Connect.NextHandleFunction = (request, response, next) => {
    if (
      request.method !== 'POST' ||
      !request.url?.startsWith(RESULT_ENDPOINT)
    ) {
      next();
      return;
    }
    readBody(request)
      .then((body) => {
        const payload = JSON.parse(body);
        appendFileSync(
          path.join(benchDir, LOG_FILE),
          `${JSON.stringify(payload)}\n`,
        );
        console.log(
          `\n─── bench result from ${payload.userAgent ?? 'unknown'}`,
        );
        console.log(payload.text ?? JSON.stringify(payload, null, 2));
        console.log(`─── appended to bench/${LOG_FILE}\n`);
        response.statusCode = 204;
        response.end();
      })
      .catch((error) => {
        console.error('bench result rejected:', error.message);
        response.statusCode = 400;
        response.end();
      });
  };

  return {
    name: 'bench-result-sink',
    // Registered on both servers so an interactive `bench:dev` session reports
    // the same way a measured `bench:serve` run does.
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(handler);
    },
  };
}
