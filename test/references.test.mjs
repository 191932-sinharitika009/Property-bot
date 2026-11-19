import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReference, STARTER_OPTIONS } from '../retrieval/references.mjs';
import { createChat } from '../chat/answer.mjs';

test('initial numbered questions select the matching welcome-screen starter', () => {
  for (const q of ['tell me more about 4th', 'What about the fourth option?', 'show me option 4', '4th']) {
    assert.deepEqual(resolveReference(q), { starter_question: STARTER_OPTIONS[3], number: 4 });
  }
  assert.match(resolveReference('tell me more about 5th').clarification, /four starter/);
});
test('numbered follow-ups use displayed order and explicit starters still select welcome options', () => {
  const context = { displayed_ids: ['z', 'a', 'b', 'c'] };
  assert.deepEqual(resolveReference('tell me more about 4th', context), { id: 'c', number: 4 });
  assert.deepEqual(resolveReference('tell me more about 4th starter', context), { starter_question: STARTER_OPTIONS[3], number: 4 });
  assert.match(resolveReference('What about the fifth?', context).clarification, /previous answer showed 4/);
  assert.match(resolveReference('Compare the first and fourth', context).clarification, /one numbered/);
  assert.match(resolveReference('Tell me about first and fourth', context).clarification, /one numbered/);
});
test('numeric property filters are not interpreted as source references', () => {
  assert.equal(resolveReference('Riyadh villas with 4 bedrooms'), null);
  assert.equal(resolveReference('show me 4 bedrooms'), null);
});
test('ambiguous pronouns clarify; a selected property supports its-price follow-up', () => {
  assert.match(resolveReference('tell me more', { displayed_ids: ['a', 'b'] }).clarification, /Which property/);
  assert.equal(resolveReference('What is its price?', { selected_id: 'b' }).id, 'b');
});

const records = Array.from({ length: 5 }, (_, i) => ({ schema_version: 1, id: `darglobal:${i}`, source: 'darglobal',
  record_type: 'project', title: `Project ${i}`, source_url: `https://darglobal.co.uk/project-${i}`,
  collected_at: '2026-11-19', location: { city: 'Dubai', country: 'United Arab Emirates' },
  property_type: 'villa', offer: {}, bedrooms: { count: null, options: [2] }, area: { sqm: null },
  amenities: ['Swimming pool'], quality: { blocked_fields: [], warnings: [] } }));
test('initial fourth starter retrieves pool projects; later fourth selects the fourth displayed citation', async () => {
  const calls = [];
  const chat = createChat(records, { completeImpl: async messages => {
    const payload = JSON.parse(messages[1].content); calls.push(payload);
    const ids = payload.evidence.map(r => r.id).reverse();
    return { content: JSON.stringify({ statements: ids.map(id => ({ text: 'Published property details.', source_ids: [id] })) }) };
  } });
  const first = await chat('tell me more about 4th');
  assert.equal(first.status, 'answer');
  assert.equal(calls[0].selected_starter.question, STARTER_OPTIONS[3]);
  assert.equal(first.context.displayed_ids[3], 'darglobal:1');
  const followup = await chat('tell me more about 4th', first.context);
  assert.equal(followup.status, 'answer');
  assert.equal(calls[1].evidence.length, 1);
  assert.equal(calls[1].selected_property.id, 'darglobal:1');
  await chat('what is its price?', followup.context);
  assert.equal(calls[2].evidence[0].id, 'darglobal:1');
  assert.equal(calls.length, 3);
});
