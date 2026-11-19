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
  const second = await post({ question: 'two' }, cookie);
  assert.ok(second.headers.get('set-cookie').startsWith(cookie + ';'));
  const secondTurn = await second.json();
  assert.equal(secondTurn.message, '1');
  assert.equal((await (await post({ question: 'other' })).json()).message, '0');
  assert.equal((await post({viewId: secondTurn.viewId}, cookie, '/api/reset')).status, 200);
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

test('Safari sequence, view conflicts, session expiry and restart from welcome', async t => {
  const { createChat } = await import('../chat/answer.mjs');
  const { loadRecords } = await import('../retrieval/search.mjs');
  const records = await loadRecords();
  let clock = 100;
  const plans = {
    'Show rentals in Riyadh': { action: 'search', text: '', card: 0, filters: [{key:'city', value:'Riyadh'},{key:'transaction',value:'rent'}] },
    hello: { action: 'general', text:'', card:0, filters:[] },
    'Where can I lease a home?': { action:'cities', text:'', card:0, filters:[{key:'transaction',value:'rent'},{key:'record_type',value:'listing'}] }
  };
  const chat = createChat(records, { completeImpl: async (messages, options) => {
    if (options.responseFormat) return { content: JSON.stringify(plans[JSON.parse(messages[1].content).question]) };
    if (options.conversation) return { content: 'Hello!' };
    const { evidence } = JSON.parse(messages[1].content);
    return { content: JSON.stringify({ statements: evidence.map(r => ({ record_id:r.id, fields:['location'] })) }) };
  } });
  const { post } = await fixture(t, { records, chat, rateLimit:100, now:() => clock });
  let cookie, viewId;
  async function ask(question, welcomeVisible = false) {
    const res = await post({question, viewId, welcomeVisible}, cookie);
    cookie = res.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    const data = await res.json();
    viewId = data.viewId ?? viewId;
    return data;
  }
  const list = await ask('Show rentals in Riyadh', true);
  assert.equal(list.sources.length, 3);
  const second = list.sources[1].id;
  for (const q of ['explain 2','yes, the second one','hello','yes 2nd property','2']) {
    const result = await ask(q);
    if (q === 'hello') assert.equal(result.message, 'Hello!');
    else assert.deepEqual(result.sources.map(s => [s.id, s.number]), [[second, 2]]);
  }
  const cities = await ask('Where can I lease a home?');
  assert.deepEqual(cities.statements.map(s => s.text.split(' — ')[0]), ['Jeddah','Riyadh']);
  assert.equal((await post({question:'2',viewId:list.viewId},cookie)).status,409);
  assert.equal((await post({question:'2',viewId},undefined)).status,409);
  clock += 1800001;
  assert.equal((await ask('2')).code, 'stale_view');
  await post({},cookie,'/api/reset');
  cookie = undefined; viewId = null;
  assert.equal((await ask('2')).status,'clarification_required');
  assert.equal((await ask('2',true)).status,'answer');
});

test('reset is scoped to a tab and a stale reset cannot delete its newer view', async t => {
  const { post } = await fixture(t, {chat: async (_, ctx) => ({status:'answer', context:{turn:(ctx.turn ?? 0)+1}, message:String(ctx.turn ?? 0)})});
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
  const first = await post({question:'start',tabId:a});
  const ca = first.headers.get('set-cookie').split(';')[0], va = (await first.json()).viewId;
  const other = await post({question:'start',tabId:b}, ca);
  const cookies = ca + '; ' + other.headers.get('set-cookie').split(';')[0];
  const vb = (await other.json()).viewId;
  const next = await (await post({question:'next', tabId:a, viewId:va},cookies)).json();
  assert.equal((await post({tabId:a,viewId:va},cookies,'/api/reset')).status,409);
  assert.equal((await post({tabId:b,viewId:vb},cookies,'/api/reset')).status,200);
  assert.equal((await (await post({question:'again',tabId:a,viewId:next.viewId},cookies)).json()).message,'2');
});
