import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../scrapers/normalize.mjs';
const page = (extra = {}) => ({ id: 'example', source: 'wasalt', source_url: 'https://wasalt.sa/en/property/sale/example', structured_data: [{
  '@type': 'SingleFamilyResidence', name: 'Villa sample',
  description: '<p>Land Area: 333 SQM</p><p>The property has 5 bedrooms</p><p>Price: 1600000 SAR</p>',
  numberOfBedrooms: '5', address: { addressLocality: 'Riyadh' },
  offers: [{ price: 1600000, priceCurrency: 'SAR' }], ...extra
}] });
test('maps property values and preserves land area meaning', () => {
  const { record } = normalize(page());
  assert.equal(record.price, 1600000);
  assert.equal(record.bedrooms, 5);
  assert.equal(record.area_sqm, 333);
  assert.equal(record.area_type, 'land');
  assert.equal(record.validation.status, 'checks_passed');
});
test('quarantines conflicting fields rather than silently trusting metadata', () => {
  const { record } = normalize(page({ offers: [{ price: 999, priceCurrency: 'SAR' }] }));
  assert.ok(record.validation.issues.includes('price_conflict'));
});
test('missing values remain null and full descriptions are not copied', () => {
  const { record } = normalize(page({ offers: [], numberOfBedrooms: undefined }));
  assert.equal(record.price, null);
  assert.equal(record.bedrooms, null);
  assert.equal(record.description, undefined);
});
test('rejects category pages without a property entity', () => {
  assert.equal(normalize({ structured_data: [{ '@type': 'BreadcrumbList' }] }).record, null);
});
test('separates explicit rental period from currency and checks visible amount', () => {
  const input = page({ offers: [{ price: 1600000, priceCurrency: 'SAR /Year' }] });
  input.source_url = 'https://wasalt.sa/en/property/rent/example';
  input.text = '333 SQM\nland area\n1,600,000/Year\nAdditional Information';
  const { record } = normalize(input);
  assert.equal(record.currency, 'SAR');
  assert.equal(record.price_period, 'year');
  assert.equal(record.validation.status, 'checks_passed');
});
test('visible area fallback excludes recommendation cards and flags conflicts', () => {
  const input = page({ description: '' });
  input.text = '271.8 SQM\nمساحة الأرض\n900,000\nAdditional Information\n999 SQM\nland area\n999';
  const { record } = normalize(input);
  assert.equal(record.area_sqm, 271.8);
  assert.equal(record.area_type, 'land');
  assert.ok(record.validation.issues.includes('visible_price_conflict'));
});
