import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface HttpTestServer {
  /** e.g. `http://127.0.0.1:54321`, on a free port. */
  readonly baseUrl: string;
  /** Resolves once the client closes the next `POST /slow` request, which never gets an answer. */
  nextSlowRequestClosed(): Promise<void>;
  close(): void;
}

/**
 * A local HTTP server with fixed routes, so that integration specs go through Angular's actual
 * `FetchBackend` / `HttpXhrBackend` (Node's fetch, jsdom's XHR) instead of
 * `HttpClientTestingBackend`. CORS is wide open because jsdom's XHR enforces it.
 *
 * | Route             | Response                                               |
 * | ----------------- | ------------------------------------------------------ |
 * | `POST /users`     | `201`, `{ id: 1, ...body }`, `Location: /users/1`      |
 * | `DELETE /users/1` | `204`, no body                                         |
 * | `POST /invalid`   | `422`, `{ message: 'invalid' }`                        |
 * | `POST /upload`    | `200`, `{ received: <body length> }`                   |
 * | `POST /pdf`       | `200`, `%PDF-1.7` as `application/pdf`                 |
 * | `POST /slow`      | never answers: see `nextSlowRequestClosed()`           |
 */
export async function startHttpTestServer(): Promise<HttpTestServer> {
  const slowRequestClosedListeners: Array<() => void> = [];

  function route(method: string | undefined, url: string | undefined, body: string, res: ServerResponse): void {
    const reply = (status: number, payload?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, payload === undefined ? headers : { 'Content-Type': 'application/json', ...headers });
      res.end(payload === undefined ? undefined : JSON.stringify(payload));
    };
    switch (`${method} ${url}`) {
      case 'POST /users':
        return reply(201, { id: 1, ...JSON.parse(body) }, { Location: '/users/1' });
      case 'DELETE /users/1':
        return reply(204);
      case 'POST /invalid':
        return reply(422, { message: 'invalid' });
      case 'POST /upload':
        return reply(200, { received: body.length });
      case 'POST /pdf':
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end('%PDF-1.7');
        return;
      case 'POST /slow':
        res.on('close', () => slowRequestClosedListeners.shift()?.());
        return;
      default:
        return reply(404);
    }
  }

  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Location');
    if (req.method === 'OPTIONS') {
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => route(req.method, req.url, Buffer.concat(chunks).toString(), res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    nextSlowRequestClosed: () => new Promise((resolve) => slowRequestClosedListeners.push(resolve)),
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}
