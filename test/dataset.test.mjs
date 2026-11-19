import test from 'node:test';
import assert from 'node:assert/strict';
import { curate, digest } from '../scripts/dataset-core.mjs';
const input = (changes = {}) => ({ id: 'sample', source: 'wasalt', source_url: 'https://wasalt.sa/en/property/sale/sample',
  scraped_at: '2026-11-19T00:00:00Z', record_type: 'property', title: 'Apartment 900 SQM with 4 Bedrooms',
  city: 'Riyadh', country: 'Saudi Arabia', price: 470000, currency: 'SAR', transaction_type: 'sale',
  area_sqm: 900, area_type: 'built_up', bedrooms: 4, validation: { status: 'checks_passed', issues: [] }, ...changes });
const reviewed = (record, extra = {}) => ({ record_sha256: digest(record), note: 'Reviewed fixture', ...extra });

test('uncertain area is removed from numeric fields and searchable title', () => {
  const record = input({ validation: { issues: ['unusually_large_apartment_area_review'] } });
  const result = curate(record, reviewed(record));
  assert.equal(result.area.sqm, null);
  assert.equal(result.area.range_sqm, null);
  assert.doesNotMatch(result.search_text, /900/);
  assert.equal(result.offer.amount, 470000);
  assert.ok(result.quality.blocked_fields.includes('area'));
});
test('reviews fail closed when source values change or review is missing', () => {
  const record = input({ validation: { issues: ['area_conflict'] } });
  assert.throws(() => curate(record), /Review required/);
  const decision = reviewed(record);
  assert.throws(() => curate({ ...record, price: 1 }, decision), /Stale review/);
});
test('new unknown validation issues require a handling policy', () => {
  const record = input({ validation: { issues: ['new_problem'] } });
  assert.throws(() => curate(record, reviewed(record)), /Unknown validation/);
});
test('project options do not become individual listing bedroom counts', () => {
  const record = input({ source: 'darglobal', source_url: 'https://darglobal.co.uk/example', record_type: 'project',
    country: 'UAE', bedroom_options: [1, 2, 3], price: null, currency: null, transaction_type: null });
  const result = curate(record);
  assert.equal(result.record_type, 'project');
  assert.equal(result.bedrooms.count, null);
  assert.deepEqual(result.bedrooms.options, [1, 2, 3]);
  assert.equal(result.location.country, 'United Arab Emirates');
});
test('raw descriptions, contact fields and pool conflicts stay out of retrieval', () => {
  const record = input({ amenities: ['Pool'], text: 'Agent contact', phone: 'private' });
  const result = curate(record, reviewed(record, { blocked_fields: ['amenities'], warnings: ['source_pool_claim_conflict'] }));
  assert.deepEqual(result.amenities, []);
  assert.doesNotMatch(JSON.stringify(result), /Agent contact|private|Pool/);
});
test('unresolved rental periods disable price comparisons', () => {
  const record = input({ transaction_type: 'rent', price_period: 'year', validation: { issues: ['rental_period_conflict'] } });
  const result = curate(record, reviewed(record));
  assert.equal(result.offer.amount, null);
  assert.equal(result.offer.period, null);
});
test('possible duplicate records retain independent source identity', () => {
  const record = input();
  const result = curate(record, reviewed(record, { duplicate_group: 'group' }));
  assert.equal(result.id, 'wasalt:sample');
  assert.equal(result.source_url, record.source_url);
  assert.equal(result.quality.duplicate_group, 'group');
});
