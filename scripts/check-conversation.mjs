// Exercise the same HTTP and cookie-session paths used by the browser.
import assert from 'node:assert/strict';
const origin = new URL(process.argv[2] || 'http://127.0.0.1:8000');
let cookie, viewId;
async function ask(question) {
  const response = await fetch(new URL('/api/chat', origin), { method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ question, viewId, welcomeVisible: !viewId }), signal: AbortSignal.timeout(195_000) });
  cookie = response.headers.getSetCookie()[0]?.split(';')[0] || cookie;
  const data = await response.json();
  viewId = data.viewId ?? viewId;
  assert.ok(response.ok, data.code || data.message);
  console.log(question, data.status, data.message || data.statements?.map(s => s.text).join(' '));
  return data;
}
const general = await ask('What is the difference between renting and buying?');
assert.equal(general.generated_by, 'openrouter');
assert.ok(general.message && !general.sources.length);
const search = await ask('Which DarGlobal developments mention a swimming pool?');
assert.ok(search.sources.length >= 2);
const second = await ask('Tell me more about 2');
assert.deepEqual(second.sources.map(s => s.id), [search.sources[1].id]);
const pool = await ask('Does it have a private pool in each unit?');
assert.deepEqual(pool.sources.map(s => s.id), [search.sources[1].id]);
assert.equal((await ask('Tell me more about 9')).status, 'clarification_required');
const change = await ask('What is a lease agreement?');
assert.ok(change.message && !change.sources.length);

const rentals = await ask('Show rental listings in Riyadh');
assert.ok(rentals.sources.length >= 2);
const target = rentals.sources[1].id;
for (const q of ['explain 2', 'hello', 'yes, the second one']) {
  const reply = await ask(q);
  if (q === 'hello') assert.ok(reply.message);
  else assert.deepEqual(reply.sources.map(s => [s.id, s.number]), [[target, 2]]);
}
const cities = await ask('Which cities in the collection have homes to lease?');
assert.deepEqual(cities.statements.map(s => s.text.split(' — ')[0]), ['Jeddah', 'Riyadh']);
