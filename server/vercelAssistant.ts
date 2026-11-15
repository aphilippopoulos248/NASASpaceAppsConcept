// The Vercel function behind /api/assistant: the same handler that server/plugin.ts serves
// in `npm run dev`. scripts/build-api.mjs bundles this file to api/assistant.js, the only
// place Vercel looks for functions. Credentials there: ANTHROPIC_API_KEY in the project's
// environment variables (a local `ant auth login` profile does not exist on Vercel).
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler from './api/assistant';

type VercelRequest = IncomingMessage & { body?: unknown };

async function jsonBody(req: VercelRequest): Promise<unknown> {
  let raw: unknown;
  if ('body' in req) {
    // Vercel has already read the request stream (reading it again would never end) and parses on access.
    try {
      raw = req.body;
    } catch {
      return undefined;
    }
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    raw = Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw !== 'string') return raw;
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export default async function assistant(req: VercelRequest, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const gone = new AbortController();
  res.on('close', () => gone.abort());
  try {
    const method = req.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : await jsonBody(req);
    const out = await handler({ method, subpath: '', query: url.searchParams, headers: req.headers, body, rawBody: body === undefined ? '' : JSON.stringify(body), signal: gone.signal });
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
  } catch (err) {
    console.error('[api/assistant]', err);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: { kind: 'server', message: 'Internal error in the assistant function.' } }));
  }
}
