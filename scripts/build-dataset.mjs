import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';
import { curate, digest } from './dataset-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async path => readFile(join(root, path), 'utf8');
const inputs = ['data/wasalt/properties.jsonl', 'data/darglobal/crawl/projects.jsonl'];
const decisions = JSON.parse(await read('data/review/decisions.json'));
for (const decision of Object.values(decisions.records)) {
  const snapshot = resolve(root, decision.source_snapshot);
  if (!snapshot.startsWith(resolve(root, 'data') + sep)) throw new Error('Review snapshot outside project data');
  if (digest(await readFile(snapshot, 'utf8')) !== decision.source_snapshot_sha256) throw new Error(`Changed review snapshot: ${decision.source_snapshot}`);
}
const original = (await Promise.all(inputs.map(read))).flatMap(text => text.trim().split('\n').filter(Boolean).map(JSON.parse));
const records = original.map(record => curate(record, decisions.records[record.id]));
if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('Duplicate record IDs');
if (new Set(records.map(r => r.source_url)).size !== records.length) throw new Error('Duplicate source URLs');
const version = digest(records).slice(0, 16);
const folder = join(root, 'data/curated');
await mkdir(folder, { recursive: true });
const counts = {};
for (const record of records) counts[record.source] = (counts[record.source] || 0) + 1;
const manifest = {
  schema_version: 1, dataset_version: version, built_at: new Date().toISOString(),
  records: records.length, sources: counts, input_files: inputs,
  checks_passed: records.filter(r => r.quality.status === 'checks_passed').length,
  usable_with_caveats: records.filter(r => r.quality.status === 'usable_with_caveats').length,
  records_with_blocked_area: records.filter(r => r.quality.blocked_fields.includes('area')).length,
  possible_duplicate_groups: [...new Set(records.map(r => r.quality.duplicate_group).filter(Boolean))],
  collection_dates: [...new Set(records.map(r => r.collected_at.slice(0, 10)))],
  reviews_sha256: digest(decisions),
  limitations: ['Subset of both sites, not full market coverage.', 'Source claims and availability are not independently verified.',
    'Blocked fields must not be used for comparisons or filters.', 'Possible duplicate listings remain separate; do not call record counts unique property counts.']
};
const csvCell = v => { let t = v == null ? '' : String(v); if (/^[=+@\-\t\r]/.test(t)) t = `'${t}`; return `"${t.replaceAll('"', '""')}"`; };
const columns = ['source', 'record_type', 'title', 'city', 'country', 'price', 'currency', 'period', 'area_sqm', 'area_min_sqm', 'area_max_sqm', 'quality', 'blocked_fields', 'source_url'];
const csv = [columns.join(','), ...records.map(r => [r.source, r.record_type, r.title, r.location.city, r.location.country,
  r.offer.amount, r.offer.currency, r.offer.period, r.area.sqm, r.area.range_sqm?.min, r.area.range_sqm?.max,
  r.quality.status, r.quality.blocked_fields.join('; '), r.source_url].map(csvCell).join(','))].join('\r\n');
for (const [name, content] of Object.entries({ 'records.jsonl': records.map(r => JSON.stringify(r)).join('\n') + '\n',
  'records.csv': '\uFEFF' + csv + '\r\n', 'manifest.json': JSON.stringify(manifest, null, 2) })) {
  await writeFile(join(folder, name + '.tmp'), content);
  await rename(join(folder, name + '.tmp'), join(folder, name));
}
console.log(JSON.stringify(manifest, null, 2));
