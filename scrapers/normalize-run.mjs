import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { normalize } from './normalize.mjs';

if (!process.argv[2]) throw new Error('Usage: node scrapers/normalize-run.mjs data/runs/<run>');
const directory = resolve(process.argv[2]);
const pages = (await readFile(join(directory, 'pages.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const results = pages.map(page => ({ id: page.id, ...normalize(page) }));
const unique = new Map(results.filter(r => r.record).map(r => [r.record.source_url, r.record]));
const records = [...unique.values()];
const fingerprints = new Map();
for (const record of records) {
  const key = JSON.stringify([record.source, record.title, record.city, record.district,
    record.price, record.currency, record.bedrooms, record.area_sqm, record.area_type]);
  const group = fingerprints.get(key) || [];
  group.push(record.id);
  fingerprints.set(key, group);
}
await writeFile(join(directory, 'properties.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
const columns = ['id', 'source', 'title', 'city', 'district', 'property_type', 'transaction_type', 'price', 'currency', 'price_period', 'bedrooms', 'area_sqm', 'area_type', 'source_url', 'scraped_at', 'availability', 'validation_status', 'review_issues'];
const csvCell = value => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
const csv = [columns.join(','), ...records.map(record => {
  const row = { ...record, validation_status: record.validation.status, review_issues: record.validation.issues.join('; ') };
  return columns.map(key => csvCell(row[key])).join(',');
})].join('\r\n');
await writeFile(join(directory, 'properties.csv'), '\uFEFF' + csv + '\r\n');
const countBy = field => records.reduce((result, record) => {
  const key = record[field] ?? 'unknown';
  result[key] = (result[key] || 0) + 1;
  return result;
}, {});
const report = {
  input_pages: pages.length, normalized_records: records.length,
  checks_passed: records.filter(r => r.validation.status === 'checks_passed').length,
  possible_duplicate_groups: [...fingerprints.values()].filter(group => group.length > 1),
  coverage: { cities: countBy('city'), property_types: countBy('property_type'), transactions: countBy('transaction_type') },
  missing_fields: Object.fromEntries(['city', 'price', 'currency', 'bedrooms', 'area_sqm', 'property_type', 'transaction_type'].map(field => [field, records.filter(r => r[field] === null).length])),
  needs_review: records.filter(r => r.validation.status !== 'checks_passed').map(r => ({ id: r.id, issues: r.validation.issues })),
  skipped: results.filter(r => !r.record).map(r => ({ id: r.id, reason: r.reason })),
  note: 'Automated consistency checks do not verify present-day availability or source accuracy.'
};
await writeFile(join(directory, 'validation.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
