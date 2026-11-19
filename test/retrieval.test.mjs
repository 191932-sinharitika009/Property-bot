import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearch } from '../retrieval/search.mjs';
import { answerSearch } from '../retrieval/question.mjs';

function record(id, changes = {}) {
  return { schema_version: 1, id, source: 'wasalt', record_type: 'listing',
    title: 'Sample villa', source_url: `https://wasalt.sa/${id}`, collected_at: '2026-11-19',
    location: { city: 'Riyadh', country: 'Saudi Arabia' }, property_type: 'villa',
    offer: { amount: 1000, currency: 'SAR', transaction: 'sale', period: null },
    bedrooms: { count: 4, options: [] }, area: { sqm: 100, range_sqm: null },
    amenities: ['Swimming pool'], quality: { blocked_fields: [], warnings: [] }, ...changes };
}
const sale = { transaction: 'sale', currency: 'SAR' };

test('budget excludes unknown prices and other currencies, periods and transactions', () => {
  const search = createSearch([record('yes'), ...[
    { amount: null }, { currency: 'USD' }, { transaction: 'rent', period: 'year' },
  ].map((offer, i) => record(`no${i}`, { offer: { ...record('x').offer, ...offer } }))]);
  assert.deepEqual(search({ filters: { ...sale, max_price: 1000 } }).results.map(r => r.record.id), ['yes']);
  const rentals = createSearch(['month', 'year'].map(period => record(period, { offer: { amount: 1000, currency: 'SAR', transaction: 'rent', period } })));
  assert.equal(rentals({ filters: { transaction: 'rent', currency: 'SAR', period: 'year', max_price: 2000 } }).results[0].record.id, 'year');
});
test('strict budget boundaries differ from inclusive bounds', () => {
  const records = [record('boundary')], search = createSearch(records);
  assert.equal(answerSearch('Villas for sale under SAR 1000', records, search).total, 0);
  assert.equal(answerSearch('Villas for sale up to SAR 1000', records, search).total, 1);
});
test('ambiguous budgets yield clarification and no evidence', () => {
  const search = createSearch([record('one')]);
  for (const filters of [{ max_price: 2000 }, { max_price: 2000, currency: 'SAR', transaction: 'rent' }]) {
    const result = search({ filters });
    assert.equal(result.status, 'clarification_required');
    assert.equal(result.results.length, 0);
  }
});
test('blocked fields cannot match numeric, amenity or location filters even if stale values remain', () => {
  const search = createSearch([record('blocked', { quality: { blocked_fields: ['area', 'price', 'bedrooms', 'amenities', 'country', 'city', 'property_type'] } })]);
  for (const filters of [{ min_area: 1 }, { ...sale, max_price: 2000 }, { bedrooms: 4 }, { amenity: 'pool' }, { country: 'Saudi Arabia' }, { city: 'Riyadh' }, { property_type: 'villa' }]) {
    assert.equal(search({ filters }).total, 0);
  }
  assert.equal(search({ query: 'pool' }).total, 0);
});
test('project options stay distinct from listing counts and range filters require the entire range', () => {
  const search = createSearch([record('project', { record_type: 'project', bedrooms: { count: null, options: [2, 3] }, area: { sqm: null, range_sqm: { min: 80, max: 300 } } })]);
  assert.equal(search({ filters: { bedrooms: 3 } }).total, 1);
  assert.equal(search({ filters: { min_area: 100 } }).total, 0);
  assert.equal(search({ filters: { min_area: 80, max_area: 300 } }).total, 1);
});
test('follow-up retains filters; a new question resets them', () => {
  const records = [record('a')], search = createSearch(records);
  const first = answerSearch('Riyadh villas for sale up to SAR 2000', records, search);
  const follow = answerSearch('Only 4 bedrooms', records, search, first.context);
  assert.equal(follow.total, 1);
  assert.equal(follow.filters.max_price, 2000);
  const reset = answerSearch('Sample', records, search, follow.context);
  assert.deepEqual(reset.filters, {});
});
test('unknown terms never silently return all records; ranking favors title matches', () => {
  const search = createSearch([record('amenity', { amenities: ['Garden'] }), record('title', { title: 'Garden villa' })]);
  assert.equal(search({ query: 'garden' }).results[0].record.id, 'title');
  assert.equal(search({ query: 'quantum football' }).status, 'no_matches');
});
test('duplicates retain identities, warnings and bounded citations', () => {
  const search = createSearch(['a', 'b'].map(id => record(id, { quality: { blocked_fields: [], warnings: ['possible_duplicate_listing'], duplicate_group: 'pair' } })));
  const result = search({ limit: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].record.quality.duplicate_group, 'pair');
  assert.ok(result.results[0].record.source_url);
});
test('reject malformed filters and unbounded queries', () => {
  const search = createSearch([]);
  for (const filters of [{ max_price: '1000' }, { bedrooms: 2.5 }, { transaction: 'lease' }, { sql: 'anything' }, { min_area: 200, max_area: 100 }]) assert.throws(() => search({ filters }));
  assert.throws(() => search({ limit: 100 }));
  assert.throws(() => search({ query: 'a'.repeat(2001) }));
});
test('multiple values and exclusions request clarification rather than overriding constraints', () => {
  const records = [record('a')], search = createSearch(records);
  for (const q of ['Villas and apartments', 'Projects without a pool', 'Villas below SAR 1000 or USD 500', 'Projects with a pool and gym']) {
    assert.equal(answerSearch(q, records, search).status, 'clarification_required', q);
  }
});

test('non-Latin queries and amenities cannot widen to an unfiltered search', () => {
  const search = createSearch([record('latin'), record('arabic', { title: 'شقة', amenities: ['مسبح'] })]);
  for (const args of [{query:'شقة'}, {filters:{amenity:'مسبح'}}])
    assert.deepEqual(search(args).results.map(r => r.record.id), ['arabic']);
  for (const args of [{query:'🏡'}, {filters:{amenity:'?!'}}])
    assert.equal(search(args).status, 'clarification_required');
});

test('all inclusive and exclusive budget bound combinations agree with interval arithmetic', () => {
  const search = createSearch([record('boundary')]);
  for (const min of ['min_price','min_price_exclusive']) for (const max of ['max_price','max_price_exclusive']) {
    for (const lo of [999,1000,1001]) for (const hi of [999,1000,1001]) {
      const run = () => search({filters:{...sale,[min]:lo,[max]:hi}});
      const strictMin = min.endsWith('exclusive'), strictMax = max.endsWith('exclusive');
      if (lo > hi || (lo === hi && (strictMin || strictMax))) assert.throws(run, /bounds/);
      else assert.equal(run().total, Number((strictMin ? lo < 1000 : lo <= 1000) && (strictMax ? hi > 1000 : hi >= 1000)));
    }
  }
});
