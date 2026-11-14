// Serves /api/<name> from server/api/<name>.ts in both `npm run dev` and `npm run preview`.
//
// A handler module default-exports an ApiHandler. It runs in Node on the server only, so it
// may read secrets from process.env; nothing here is bundled into the browser.
// In dev, handlers reload on change (Vite SSR module graph); in preview they are loaded once.
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { runnerImport, type Connect, type Plugin, type ViteDevServer } from 'vite';

export interface ApiRequest {
  method: string;
  /** Path after /api/<name>, e.g. "" or "/foo". */
  subpath: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  /** Parsed JSON body (undefined when empty or not JSON). */
  body: unknown;
  rawBody: string;
  /** Aborted when the client disconnects. */
  signal: AbortSignal;
}

export interface ApiResponse {
  status: number;
  /** Sent as application/json. */
  json?: unknown;
  /** Sent as is (set content-type in headers). */
  body?: string | Uint8Array;
  /** Streamed chunk by chunk (e.g. server-sent events; set content-type in headers). */
  stream?: AsyncIterable<string | Uint8Array>;
  headers?: Record<string, string>;
}

export type ApiHandler = (req: ApiRequest) => ApiResponse | Promise<ApiResponse>;

const MAX_BODY_BYTES = 1_000_000;
const NAME = /^[a-z][a-z0-9-]{0,40}$/;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        fail(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

function sendJson(res: ServerResponse, status: number, json: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(json));
}

async function send(res: ServerResponse, out: ApiResponse): Promise<void> {
  res.statusCode = out.status;
  res.setHeader('cache-control', 'no-store');
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
  if (out.stream) {
    for await (const chunk of out.stream) {
      if (res.destroyed) break;
      res.write(chunk);
    }
    res.end();
  } else if (out.body !== undefined) {
    res.end(out.body);
  } else {
    if (!res.hasHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(out.json ?? null));
  }
}

type Loader = (file: string) => Promise<{ default?: ApiHandler }>;

export function apiMiddleware(root: string, load: Loader): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = /^\/api\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m) return next();
    void (async () => {
      const name = m[1];
      const file = resolve(root, 'server/api', `${name}.ts`);
      if (!NAME.test(name) || !existsSync(file)) return sendJson(res, 404, { error: `No API named "${name}".` });
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      try {
        const mod = await load(file);
        if (typeof mod.default !== 'function') return sendJson(res, 500, { error: `server/api/${name}.ts has no default export handler.` });
        const rawBody = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
        let body: unknown;
        try {
          body = rawBody ? JSON.parse(rawBody) : undefined;
        } catch {
          body = undefined;
        }
        const out = await mod.default({ method: req.method ?? 'GET', subpath: m[2] ?? '', query: url.searchParams, headers: req.headers, body, rawBody, signal: controller.signal });
        await send(res, out);
      } catch (err) {
        const status = (err as { status?: number }).status ?? 500;
        console.error(`[api/${name}]`, err);
        if (!res.headersSent) sendJson(res, status, { error: status === 413 ? 'Request body too large.' : 'Internal error in the API handler.' });
        else res.end();
      }
    })();
  };
}

export function lunyxApi(): Plugin {
  let root = process.cwd();
  return {
    name: 'lunyx-api',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(apiMiddleware(root, (file) => server.ssrLoadModule(file) as Promise<{ default?: ApiHandler }>));
    },
    configurePreviewServer(server) {
      const cache = new Map<string, Promise<{ default?: ApiHandler }>>();
      const load: Loader = (file) => {
        let p = cache.get(file);
        if (!p) {
          p = runnerImport<{ default?: ApiHandler }>(file, { configFile: false, root, logLevel: 'error' }).then((r) => r.module);
          p.catch(() => cache.delete(file));
          cache.set(file, p);
        }
        return p;
      };
      server.middlewares.use(apiMiddleware(root, load));
    },
  };
}
