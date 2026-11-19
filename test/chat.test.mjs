import test from 'node:test';
import assert from 'node:assert/strict';
import { complete, ChatError } from '../chat/openrouter.mjs';
import { createChat, validateAnswer } from '../chat/answer.mjs';

const record = { id: 'darglobal:test', title: 'Les Vagues', source: 'darglobal', record_type: 'project',
  source_url: 'https://darglobal.co.uk/les-vagues', collected_at: '2026-11-19',
  location: { city: 'Doha', country: 'Qatar' }, property_type: 'apartment', offer: { amount: null },
  bedrooms: { count: null, options: [1, 2, 3] }, area: { sqm: null }, amenities: [],
  quality: { blocked_fields: ['area'], warnings: ['conflicting_area_ranges'] }, availability: 'not_verified' };
const content = JSON.stringify({ statements: [{ text: 'Bedroom options include 1, 2 and 3.', source_ids: [record.id] }] });
const response = body => new Response(JSON.stringify(body), { status: 200 });
const success = { model: 'test:free', choices: [{ finish_reason: 'stop', message: { content } }] };

test('repeated starter questions always generate a fresh answer', async () => {
  let calls = 0;
  const chat = createChat([record], { completeImpl: async () => { calls++; return { content, model: 'test:free' }; } });
  for (let i = 0; i < 2; i++) assert.equal((await chat('Les Vagues bedroom options')).generated_by, 'openrouter');
  assert.equal(calls, 2);
});

test('one incomplete generation recovers within the same request deadline', async () => {
  let calls = 0;
  const signals = [];
  const result = await complete([], { apiKey: 'test', fetchImpl: async (_, options) => {
    signals.push(options.signal);
    calls++;
    return response(calls === 1 ? { choices: [{ finish_reason: 'length', message: { content: '' } }] } : success);
  } });
  assert.equal(calls, 2);
  assert.equal(result.recovery_attempts, 1);
  assert.equal(signals[0], signals[1]);
});
test('repeated empty responses stop after one recovery and expose retrieved evidence honestly', async () => {
  let calls = 0;
  const chat = createChat([record], { apiKey: 'test', fetchImpl: async () => { calls++; return response({ choices: [] }); } });
  const result = await chat('Les Vagues');
  assert.equal(calls, 2);
  assert.equal(result.status, 'error');
  assert.equal(result.generated_by, 'application');
  assert.equal(result.evidence[0].id, record.id);
  assert.match(result.message, /not an AI answer/);
});

test('client sends bounded free-model request to fixed endpoint', async () => {
  const result = await complete([{ role: 'user', content: 'test' }], { apiKey: 'test-secret', model: 'example:free', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, 2400);
    assert.deepEqual(body.reasoning, { enabled: false });
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.response_format.json_schema.schema.properties.statements.items.required, ['text', 'source_ids']);
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
    assert.equal(body.stream, false);
    return response(success);
  } });
  assert.equal(result.model, 'test:free');
  assert.equal(result.requested_model, 'example:free');
});
test('missing key and paid configuration never invoke provider', async () => {
  const fetchImpl = () => assert.fail('Must not request');
  await assert.rejects(complete([], { apiKey: '', fetchImpl }), { code: 'missing_key' });
  await assert.rejects(complete([], { apiKey: 'test', model: 'paid/model', fetchImpl }), { code: 'paid_model_disabled' });
});
test('provider failures are sanitized and never retried or switched to paid models', async () => {
  for (const [status, code] of [[401, 'authentication'], [402, 'quota'], [429, 'rate_limit'], [503, 'provider_unavailable']]) {
    let calls = 0;
    await assert.rejects(complete([], { apiKey: 'test', fetchImpl: async () => { calls++; return new Response('SECRET upstream details', { status }); } }), error => error.code === code && !error.message.includes('SECRET'));
    assert.equal(calls, 1);
  }
});
test('timeout cancels the request', async () => {
  await assert.rejects(complete([], { apiKey: 'test', timeoutMs: 5, fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) }), { code: 'timeout' });
});
test('empty, truncated, malformed and embedded provider errors are rejected', async () => {
  for (const body of [{ error: { message: 'secret' } }, { choices: [] }, { choices: [{ finish_reason: 'length', message: { content } }] }]) {
    await assert.rejects(complete([], { apiKey: 'test', fetchImpl: async () => response(body) }), ChatError);
  }
  await assert.rejects(complete([], { apiKey: 'test', fetchImpl: async () => new Response('not JSON') }), { code: 'connection' });
});
test('citations resolve only to retrieved data and retain warnings', () => {
  const answer = validateAnswer(content, [record]);
  assert.equal(answer.sources[0].url, record.source_url);
  assert.deepEqual(answer.sources[0].quality.warnings, ['conflicting_area_ranges']);
  for (const bad of ['not JSON', '{}', JSON.stringify({ statements: [] }),
    JSON.stringify({ statements: [{ text: 'Claim', source_ids: ['invented'] }] }),
    JSON.stringify({ statements: [{ text: 'Claim', source_ids: [] }] }),
    JSON.stringify({ statements: [{ text: 'https://evil.example', source_ids: [record.id] }] }),
    JSON.stringify({ statements: [{ text: '<script>alert(1)</script>', source_ids: [record.id] }] })]) {
    assert.throws(() => validateAnswer(bad, [record]), { code: 'invalid_answer' });
  }
});
test('orchestrator sends evidence and resolved filters with untrusted-data instructions', async () => {
  const chat = createChat([record], { completeImpl: async messages => {
    assert.match(messages[0].content, /untrusted data/);
    const payload = JSON.parse(messages[1].content);
    assert.equal(payload.evidence.length, 1);
    assert.equal(payload.evidence[0].area.sqm, null);
    return { content, model: 'test:free', requested_model: 'test:free' };
  } });
  const result = await chat('Les Vagues bedroom options');
  assert.equal(result.status, 'answer');
  assert.equal(result.generated_by, 'openrouter');
  assert.equal(result.sources[0].id, record.id);
});
test('no-match and clarification responses use no model quota', async () => {
  const chat = createChat([record], { completeImpl: () => assert.fail('Must not call model') });
  assert.equal((await chat('Quantum football')).status, 'no_matches');
  assert.equal((await chat('Apartments below 1000')).status, 'clarification_required');
});
test('project area question reaches withheld-area evidence and plain-language instructions', async () => {
  const chat = createChat([record], { completeImpl: async messages => {
    assert.match(messages[0].content, /Never expose field names/);
    assert.equal(JSON.parse(messages[1].content).evidence[0].area.sqm, null);
    return { content: JSON.stringify({ statements: [{ text: 'The area has conflicting information.', source_ids: [record.id] }] }) };
  } });
  assert.equal((await chat('What is the area of Les Vagues?')).status, 'answer');
});
test('invalid model citations become errors, not generated answers', async () => {
  const chat = createChat([record], { completeImpl: async () => ({ content: '{}' }) });
  const result = await chat('Les Vagues');
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'invalid_answer');
  assert.deepEqual(result.sources, []);
});
test('simultaneous requests are bounded and the lock releases after completion', async () => {
  let release;
  const chat = createChat([record], { completeImpl: () => new Promise(resolve => { release = () => resolve({ content }); }) });
  const first = chat('Les Vagues');
  assert.equal((await chat('Les Vagues')).code, 'busy');
  release();
  assert.equal((await first).status, 'answer');
  const second = chat('Les Vagues');
  release();
  assert.equal((await second).status, 'answer');
});
