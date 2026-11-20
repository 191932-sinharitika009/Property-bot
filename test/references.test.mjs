import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReference, STARTER_OPTIONS } from '../retrieval/references.mjs';
import { createChat } from '../chat/answer.mjs';

test('initial numbered questions select the matching welcome-screen starter', () => {
  for (const q of ['tell me more about 4th', 'What about the fourth option?', 'show me option 4', '4th', 'tell me more about 4', '4']) {
    assert.deepEqual(resolveReference(q, { welcomeVisible: true }), { starter_question: STARTER_OPTIONS[3], number: 4 });
  }
  assert.match(resolveReference('tell me more about 5th', { welcomeVisible: true }).clarification, /four starter/);
});
test('numbered follow-ups use displayed order and explicit starters still select welcome options', () => {
  const context = { displayed_ids: ['z', 'a', 'b', 'c'] };
  assert.deepEqual(resolveReference('tell me more about 4th', context), { id: 'c', number: 4 });
  assert.match(resolveReference('tell me more about 4th starter', context).clarification, /New conversation/);
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
    return { content: JSON.stringify({ statements: ids.map(id => ({ record_id:id, fields:['status'] })) }) };
  } });
  const first = await chat('tell me more about 4th', { welcomeVisible: true });
  assert.equal(first.status, 'answer');
  assert.equal(calls[0].selected_starter.question, STARTER_OPTIONS[3]);
  assert.equal(first.context.displayed_ids[3], 'darglobal:1');
  const followup = await chat('tell me more about 4', first.context);
  assert.equal(followup.status, 'answer');
  assert.equal(calls[1].evidence.length, 1);
  assert.equal(calls[1].selected_property.id, 'darglobal:1');
  await chat('what is its price?', followup.context);
  assert.equal(calls[2].evidence[0].id, 'darglobal:1');
  assert.equal(calls.length, 3);
});

test('Safari card follow-ups keep the displayed order across a conversational reply', async () => {
  const context = { displayed_ids: ['z', 'a', 'b'] };
  const chat = createChat([], { classifyImpl: async () => ({ action: 'general' }),
    completeImpl: async () => ({ content: 'Hello.' }) });
  const greeting = await chat('hello', context);
  for (const question of ['explain 2', 'yes 2nd property', 'yes second property', '2']) {
    assert.equal(resolveReference(question, greeting.context).id, 'a');
  }
});

test('rental city coverage includes matches beyond the first five and omits sales', async () => {
  const listings = Array.from({ length: 9 }, (_, i) => ({ ...records[0], id: String(i), record_type: 'listing',
    location: { city: i < 6 ? 'Riyadh' : i < 8 ? 'Jeddah' : 'Dubai' }, offer: { transaction: i === 8 ? 'sale' : 'rent' } }));
  const result = await createChat(listings)('list the cities for which rental property is available');
  assert.deepEqual(result.statements.map(s => s.text), ['Jeddah — 2 matching listings in the snapshot.', 'Riyadh — 6 matching listings in the snapshot.']);
  assert.equal(result.sources.length, 2);
});

test('pool projects → describe each → hello → new Riyadh search', async () => {
  const { loadRecords } = await import('../retrieval/search.mjs');
  const chat = createChat(await loadRecords(), { completeImpl: async (messages, config) => {
    if (config.responseFormat) return {content: JSON.stringify({action:'general',text:'',card:0,filters:[]})};
    if (config.conversation) return {content:'Hello!'};
    const { evidence } = JSON.parse(messages.at(-1).content);
    return {content: JSON.stringify({statements:evidence.map(r => ({record_id:r.id,fields:['location']}))})};
  }});
  const pool = await chat('DarGlobal projects with a swimming pool');
  const details = await chat('describe each in detail', pool.context);
  assert.equal(details.statements.length, 5);
  assert.deepEqual(details.statements.flatMap(s => s.source_ids), pool.context.displayed_ids);
  const hello = await chat('hello', details.context);
  const city = await chat('tell me about properties in riyadh', hello.context);
  assert.deepEqual(city.context.filters, {city:'Riyadh'});
  assert.equal(city.total_matches, 11);
});

test('ordinals describing buyers or floor levels are not card selections', () => {
  for (const question of ['What is a first-time buyer?', 'Show me the first-floor apartments', 'What is a second mortgage?'])
    assert.equal(resolveReference(question,{displayed_ids:['one','two']}),null);
});

test('explicit property-type refinement retains city and transaction', async () => {
  const {loadRecords} = await import('../retrieval/search.mjs');
  const chat = createChat(await loadRecords(), { completeImpl: async messages => {
    const {evidence} = JSON.parse(messages.at(-1).content);
    return {content:JSON.stringify({statements:[{record_id:evidence[0].id,fields:['price']}]})};
  }});
  const result = await chat('Show only apartments', {filters:{city:'Riyadh',transaction:'rent'}});
  assert.deepEqual(result.context.filters, {city:'Riyadh',transaction:'rent',property_type:'apartment'});
});
