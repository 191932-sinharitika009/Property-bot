// One-off review record for the saved snapshots inspected on 2026-11-19.
// Do not rerun to approve newly scraped data without inspecting its evidence.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { digest } from './dataset-core.mjs';
const readRows = async file => (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const rows = [...await readRows('data/wasalt/properties.jsonl'), ...await readRows('data/darglobal/crawl/projects.jsonl')];
const state = JSON.parse(await readFile('data/darglobal/crawl/state.json', 'utf8'));
const notes = {
  a2e1a4361bf9cdbd: 'Description reports 271 sqm; the primary summary reports 271.8 sqm. Both retained in source evidence; area excluded from filtering.',
  '0dbf3a6d821a749f': '841.82 sqm appears in both description and primary summary for a two-bedroom apartment. Extraction agrees with the source; unusually large area remains unverified and excluded.',
  '3a1f985b71cc03e6': 'Primary summary reports 525 sqm and 2,000 SAR/year; metadata agrees on the annual price. Description does not establish an area or rental period. No inferred correction; area excluded.',
  '377c80ec146fc92c': '625 sqm appears in both description and summary for a two-bedroom apartment. Source value retained for audit; area excluded pending verification.',
  '2e59ab2ddca56578': '2985.43 sqm appears in both description and summary for a two-bedroom apartment. Source value retained; area excluded pending verification.',
  '4cdfaea897b155b0': '900 sqm appears in description and summary for a four-bedroom apartment. Source value retained; area excluded pending verification.',
  '5e673d5f1283789c': 'Summary gives 764–7,720 sqft (70.98–717.21 sqm); FAQ gives 109–722 sqm. Source conflict retained; no single range used.',
  '6e456575b925b22c': 'Summary gives 682–12,277 sqft (63.36–1140.57 sqm); FAQ gives 61–265 sqm. RAK is a regional label and the source country metadata is empty. No range or country inferred.',
  f087440b91406281: 'Fixed extraction: matching RealEstateListing.mainEntity.amenityFeature contains six amenities. The page describes the development as completed and sold out; this does not establish resale availability.',
  ee57f981864a8fd2: 'Reviewed special layout: overview states 14,768 sqft, converted to 1371.99 sqm; page states SOLD OUT. No bedroom count or price inferred.',
  '429d90ae2a80e760': 'Reviewed special layout: source describes a villa on Al Marjan Island with private elevator and beach access. Header gives RAK, not a country. No area or price supplied. Missing values remain empty.',
  db7a09530106a85b: 'Summary gives 680–1515 sqm; FAQ gives 700–1450 sqm. Unit label says Limited Collection Villas, without bedroom counts. Range and bedroom options remain unavailable.',
  a188ec4333b18750: 'Reviewed special layout: six bedrooms explicitly stated; no area supplied. THE VILLA describes an extensive swimming pool, while THE AMENITIES says space for a pool if desired. Do not assert a pool is included.',
  '436d75c0e1c94554': 'Summary gives 147–382 sqm; FAQ gives 223–553 sqm. No single range selected.',
  '26a1892c250089ba': 'Summary gives 84–383 sqm; FAQ gives 86–389 sqm. No single range selected.'
};
const duplicates = {
  ffd43c3964c41a1a: { listing_reference: '008905', ad_license: '7200795042' },
  e8d012a525301f5e: { listing_reference: '605375', ad_license: '7200795054' }
};
const records = {};
for (const record of rows) {
  if (!notes[record.id] && !duplicates[record.id]) continue;
  const path = record.source === 'wasalt' ? `data/wasalt/raw/${record.id}.html` : `data/darglobal/crawl/${state.entries.find(e => e.record?.id === record.id).html_file}`;
  const source = await readFile(path, 'utf8');
  if (duplicates[record.id] && (!source.includes(duplicates[record.id].ad_license) || !source.includes(duplicates[record.id].listing_reference))) throw new Error('Duplicate-review evidence changed');
  records[record.id] = {
    record_sha256: digest(record), source_url: record.source_url, source_snapshot: path,
    source_snapshot_sha256: digest(source),
    disposition: duplicates[record.id] ? 'retain_separate_listing' : record.validation.issues.length ? 'reviewed_with_limitations' : 'extraction_corrected',
    note: notes[record.id] || 'Matching core property details but different listing references and advertising-license IDs. Insufficient evidence of the same physical property; preserve both listings and flag possible duplication.',
    ...(duplicates[record.id] ? { duplicate_group: 'wasalt-villa-333-riyadh', identity_evidence: duplicates[record.id] } : {}),
    ...(record.id === 'a188ec4333b18750' ? { blocked_fields: ['amenities'], warnings: ['source_pool_claim_conflict'] } : {})
  };
}
for (const record of rows) if (record.validation.issues.length && !records[record.id]) throw new Error(`Unreviewed record ${record.id}`);
await mkdir('data/review', { recursive: true });
await writeFile('data/review/decisions.json', JSON.stringify({ reviewed_on: '2026-11-19', method: 'Assistant inspection of saved source HTML and publisher metadata; no independent property verification', records }, null, 2), { flag: 'wx' });
console.log(`Recorded ${Object.keys(records).length} evidence-linked review decisions.`);
