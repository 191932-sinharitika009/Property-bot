import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadEnvFile } from 'node:process';
import { loadRecords } from './retrieval/search.mjs';
import { createChat } from './chat/answer.mjs';
import { loadStarterCache } from './chat/starter-cache.mjs';

export function createServer({ records, chat = createChat(records), rateLimit = 12, now = Date.now }) {
  const sessions = new Map(), rates = new Map();
  const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  return http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') return send(200, { status: 'ok', records: records.length });
      if (req.method === 'GET' && assets[path]) {
        const [file, type] = assets[path];
        const content = await readFile(new URL(`./public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(content);
      }
      if (req.method !== 'POST' || !['/api/chat', '/api/reset'].includes(path)) return send(404, { message: 'Not found.' });
      // No cross-origin chat calls. Do not trust forwarded IPs from arbitrary clients.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { message: 'Cross-origin requests are not allowed.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { message: 'Send JSON.' });
      const time = now();
      for (const [key, value] of sessions) if (time - value.updated > 1800000) sessions.delete(key);
      for (const [key, value] of rates) if (time - value.started > 60000) rates.delete(key);
      const ip = req.socket.remoteAddress;
      const rate = rates.get(ip) ?? { started: time, count: 0 };
      rate.count++; rates.set(ip, rate);
      if (rate.count > rateLimit || rates.size > 10000) return send(429, { message: 'Too many requests. Please wait a minute.' });
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 8192) return send(413, { message: 'Message too large.' });
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { message: 'Invalid JSON.' }); }
      if (!input || typeof input !== 'object') return send(400, { message: 'Invalid request.' });
      const id = /(?:^|;\s*)property_session=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
      if (path === '/api/reset') {
        if (id) sessions.delete(id);
        res.setHeader('Set-Cookie', 'property_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return send(200, { status: 'reset' });
      }
      if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > 2000) return send(400, { message: 'Enter a question of 1–2000 characters.' });
      let session = id && sessions.get(id);
      if (!session) {
        if (sessions.size >= 1000) return send(503, { message: 'The demo is busy. Please try later.' });
        const newId = randomUUID();
        session = { context: {}, updated: time, busy: false }; sessions.set(newId, session);
        res.setHeader('Set-Cookie', `property_session=${newId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
      }
      if (session.busy) return send(409, { message: 'Please wait for your current answer.' });
      session.busy = true; session.updated = time;
      try {
        const result = await chat(input.question.trim(), session.context);
        if (result.status !== 'error') session.context = result.context ?? {};
        const { context, ...publicResult } = result;
        return send(result.status === 'error' ? 503 : 200, publicResult);
      } finally { session.busy = false; }
    } catch { if (!res.headersSent) send(500, { message: 'The request could not be completed. Please try again.' }); else res.end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const records = await loadRecords();
  const server = createServer({ records, chat: createChat(records, { starterCache: await loadStarterCache() }) });
  const port = Number(process.env.PORT || 8000);
  server.listen(port, '0.0.0.0', () => console.log(`Property chat is running at http://localhost:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
