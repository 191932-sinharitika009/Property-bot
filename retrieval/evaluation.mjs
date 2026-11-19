import assert from 'node:assert/strict';
import { createSearch } from './search.mjs';
import { answerSearch } from './question.mjs';

// Snapshot regression checks; update deliberately when reviewed coverage changes.
export function evaluateRetrieval(records) {
  const search = createSearch(records);
  const cases = [
    ['Riyadh villas for sale below SAR 2 million', 'matches', 3, r => r.source === 'wasalt' && r.location.city === 'Riyadh' && r.offer.amount < 2e6],
    ['Annual apartment rentals in Jeddah', 'matches', 1, r => r.offer.period === 'year' && r.offer.transaction === 'rent'],
    ['Les Vagues bedroom options', 'matches', 1, r => r.source_url === 'https://darglobal.co.uk/les-vagues' && r.bedrooms.options.join() === '1,2,3'],
    ['DarGlobal projects with a swimming pool', 'matches', 9, r => r.source === 'darglobal' && r.amenities.some(a => /pool/i.test(a))],
    ['Riyadh villas for sale below SAR 100000', 'no_matches', 0],
    ['DarGlobal projects in Spain', 'matches', 3, r => r.location.country === 'Spain'],
    ['Apartments for rent under SAR 5000', 'clarification_required', 0],
    ['Villas below 1000000', 'clarification_required', 0],
    ['Urban Oasis amenities', 'matches', 1, r => r.amenities.length === 6 && /sold out/i.test(r.status_as_published)],
    ['Les Vagues price', 'matches', 1, r => r.offer.amount === null && r.area.range_sqm === null],
    ['Wasalt apartments for sale with 2 bedrooms in Jeddah', 'matches', 3, r => r.bedrooms.count === 2 && r.offer.transaction === 'sale'],
    ['DarGlobal projects with 6 bedrooms', 'matches', 1, r => /Painite/.test(r.title) && r.bedrooms.count === null],
    ['Riyadh annual apartment rentals below SAR 10000', 'matches', 1, r => r.offer.amount === 6000],
    ['Who won the football match', 'no_matches', 0],
    ['DarGlobal projects in Singapore', 'no_matches', 0],
    ['Wasalt villas for sale below USD 2000000', 'no_matches', 0],
    ['Projects without a pool', 'clarification_required', 0],
    ['Villas in Riyadh or Jeddah', 'clarification_required', 0],
  ];
  const report = cases.map(([question, status, total, predicate]) => {
    const result = answerSearch(question, records, search);
    assert.equal(result.status, status, question);
    assert.equal(result.total, total, question);
    if (predicate) assert.ok(result.results.every(({ record }) => predicate(record)), question);
    for (const { record } of result.results) assert.ok(record.id && record.source_url && record.collected_at);
    return { question, status, matches: total, passed: true };
  });
  const first = answerSearch('Riyadh villas for sale below SAR 2 million', records, search);
  const next = answerSearch('Only 4 bedrooms', records, search, first.context);
  assert.equal(next.total, 1);
  assert.equal(next.filters.city, 'Riyadh');
  assert.equal(next.filters.max_price_exclusive, 2e6);
  assert.equal(next.results[0].record.offer.amount, 880000);
  report.push({ question: 'Follow-up: Only 4 bedrooms', status: next.status, matches: next.total, passed: true });
  return report;
}
