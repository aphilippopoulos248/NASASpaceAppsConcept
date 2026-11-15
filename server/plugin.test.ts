import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiMiddleware, type ApiHandler } from './plugin';

describe('API middleware', () => {
  let server: Server;
  let base = '';
  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'lunyx-api-'));
    mkdirSync(join(root, 'server/api'), { recursive: true });
    for (const n of ['echo', 'stub', 'boom']) writeFileSync(join(root, 'server/api', `${n}.ts`), '');
    const handlers: Record<string, ApiHandler> = {
      echo: (req) => ({ status: 200, json: { method: req.method, subpath: req.subpath, q: req.query.get('q'), body: req.body } }),
      stub: () => ({ status: 501, json: { error: 'not yet' } }),
      boom: () => {
        throw new Error('secret detail');
      },
    };
    const mw = apiMiddleware(root, async (file) => ({ default: handlers[basename(file, '.ts')] }));
    server = createServer((req, res) => mw(req as never, res, () => {
      res.statusCode = 418;
      res.end();
    }));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => server.close());

  it('routes /api/<name> to the handler with method, subpath, query and JSON body', async () => {
    const r = await fetch(`${base}/api/echo/x?q=1`, { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ method: 'POST', subpath: '/x', q: '1', body: { a: 1 } });
  });

  it('passes through stub status codes, 404s unknown names, hides internal errors', async () => {
    expect((await fetch(`${base}/api/stub`)).status).toBe(501);
    const missing = await fetch(`${base}/api/nope`);
    expect(missing.status).toBe(404);
    const boom = await fetch(`${base}/api/boom`);
    expect(boom.status).toBe(500);
    expect(JSON.stringify(await boom.json())).not.toContain('secret');
    expect((await fetch(`${base}/api/../etc`)).status).not.toBe(200);
    expect((await fetch(`${base}/other`)).status).toBe(418);
  });
});
