import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

async function fixture(t, options = {}) {
  const server = createServer({ records: [], ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, post: (body, cookie, path = '/api/chat', headers = {}) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: JSON.stringify(body) }) };
}
test('serves interface and health but never private files', async t => {
  const { url } = await fixture(t);
  assert.equal((await fetch(url)).status, 200);
  assert.deepEqual(await (await fetch(url + '/health')).json(), { status: 'ok', records: 0 });
  for (const path of ['/.env', '/data/curated/records.jsonl', '/server.mjs']) assert.equal((await fetch(url + path)).status, 404);
  assert.match((await fetch(url)).headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
test('sessions retain context, isolate clients and reset', async t => {
  const { post } = await fixture(t, { chat: async (q, context) => ({ status: 'answer', context: { turn: (context.turn ?? 0) + 1 }, message: String(context.turn ?? 0) }) });
  const first = await post({ question: 'one' });
  const cookie = first.headers.get('set-cookie').split(';')[0];
  assert.match(first.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await first.json()).context, undefined);
  assert.equal((await (await post({ question: 'two' }, cookie)).json()).message, '1');
  assert.equal((await (await post({ question: 'other' })).json()).message, '0');
  assert.equal((await post({}, cookie, '/api/reset')).status, 200);
  assert.equal((await (await post({ question: 'new' }, cookie)).json()).message, '0');
});
test('rejects invalid questions, oversized bodies and cross-origin calls', async t => {
  const { post } = await fixture(t, { chat: () => assert.fail('Unexpected model call') });
  assert.equal((await post({ question: '' })).status, 400);
  assert.equal((await post({ question: 'x'.repeat(2001) })).status, 400);
  assert.equal((await post({ question: 'x'.repeat(9000) })).status, 413);
  assert.equal((await post({ question: 'test' }, null, '/api/chat', { Origin: 'https://evil.example' })).status, 403);
});
test('request rate is bounded and model errors remain explicit', async t => {
  const { post } = await fixture(t, { rateLimit: 1, chat: async () => ({ status: 'error', code: 'rate_limit', message: 'Try later.' }) });
  const first = await post({ question: 'test' });
  assert.equal(first.status, 503);
  assert.equal((await first.json()).code, 'rate_limit');
  assert.equal((await post({ question: 'test' })).status, 429);
});
