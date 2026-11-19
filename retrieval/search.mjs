import { readFile } from 'node:fs/promises';

export const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const tokens = value => normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [];
const stem = token => token.length > 3 ? token.replace(/s$/, '') : token;
const words = value => new Set(tokens(value).map(stem));
export const filterKeys = Object.freeze(['source', 'record_type', 'city', 'country', 'property_type', 'transaction', 'currency', 'period', 'min_price', 'max_price', 'min_price_exclusive', 'max_price_exclusive', 'bedrooms', 'min_area', 'max_area', 'amenity']);
const allowed = new Set(filterKeys);
export const numericFilterKeys = Object.freeze(['min_price', 'max_price', 'min_price_exclusive', 'max_price_exclusive', 'bedrooms', 'min_area', 'max_area']);

export async function loadRecords(path = new URL('../data/curated/records.jsonl', import.meta.url)) {
  const records = (await readFile(path, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const ids = new Set();
  for (const record of records) {
    if (record.schema_version !== 1 || !record.id || ids.has(record.id) || !record.quality || !record.source_url) {
      throw new Error('Invalid or duplicate curated record');
    }
    ids.add(record.id);
  }
  return records;
}

export class InvalidFilters extends Error {}
export class EmptyFilterRange extends InvalidFilters {}

export function validateFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new InvalidFilters('Filters must be an object');
  for (const [key, value] of Object.entries(filters)) {
    if (!allowed.has(key)) throw new InvalidFilters(`Unsupported filter: ${key}`);
    if (numericFilterKeys.includes(key)) {
      if (!Number.isFinite(value) || value < 0 || (key === 'bedrooms' && !Number.isInteger(value))) throw new InvalidFilters(`Invalid ${key}`);
    } else if (typeof value !== 'string' || !value.trim()) throw new InvalidFilters(`Invalid ${key}`);
  }
  for (const [key, values] of Object.entries({ source: ['wasalt', 'darglobal'], record_type: ['listing', 'project'], transaction: ['sale', 'rent'], period: ['month', 'year'] })) {
    if (filters[key] && !values.includes(filters[key])) throw new InvalidFilters(`Invalid ${key}`);
  }
  for (const kind of ['price', 'area']) {
    const lower = Math.max(filters[`min_${kind}`] ?? -Infinity, filters[`min_${kind}_exclusive`] ?? -Infinity);
    const upper = Math.min(filters[`max_${kind}`] ?? Infinity, filters[`max_${kind}_exclusive`] ?? Infinity);
    if (lower > upper || (lower === upper && (filters[`min_${kind}_exclusive`] === lower || filters[`max_${kind}_exclusive`] === upper)))
      throw new EmptyFilterRange(`The ${kind} bounds leave no possible values. Please adjust the range.`);
  }
}

export function safeRecord(record) {
  const safe = structuredClone(record);
  for (const field of safe.quality.blocked_fields ?? []) {
    if (field === 'area') safe.area = { sqm: null, range_sqm: null, kind: null, unit: 'sqm' };
    if (field === 'bedrooms') safe.bedrooms = { count: null, options: [] };
    if (field === 'country') { safe.location.country = null; safe.location.country_code = null; }
    if (field === 'city') safe.location.city = null;
    if (field === 'property_type') safe.property_type = null;
    if (field === 'amenities') safe.amenities = [];
    if (field === 'price') safe.offer.amount = null;
    if (field === 'currency') safe.offer.currency = null;
    if (field === 'price_period') safe.offer.period = null;
    if (field === 'transaction_type') safe.offer.transaction = null;
  }
  // Rebuild text from approved fields; never trust stale search_text for blocked fields.
  delete safe.search_text;
  delete safe.normalized_input_sha256;
  return safe;
}

export function createSearch(records) {
  const index = records.map(safeRecord).map(record => ({ record,
    title: words(record.title),
    text: words([record.title, record.location.city, record.location.country, record.property_type, ...record.amenities].join(' ')) }));
  return function search({ query = '', filters = {}, limit = 5, groupCities = false } = {}) {
    validateFilters(filters);
    if (typeof query !== 'string' || query.length > 2000) throw new Error('Query must be text of at most 2000 characters');
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Limit must be 1–20');
    const clarification = [];
    const budget = ['min_price', 'max_price', 'min_price_exclusive', 'max_price_exclusive'].some(key => filters[key] !== undefined);
    if (budget && !filters.currency) clarification.push('Which currency is the budget in?');
    if (budget && !filters.transaction) clarification.push('Is the budget a purchase price or rent?');
    if (budget && filters.transaction === 'rent' && !filters.period) clarification.push('Is the rental budget monthly or yearly?');
    if (filters.period && filters.transaction !== 'rent') clarification.push('A rental period requires the rent transaction filter.');
    if (clarification.length) return { status: 'clarification_required', filters, clarification, total: 0, results: [] };
    const terms = [...words(query)];
    if ((query.trim() && !terms.length) || (filters.amenity && !words(filters.amenity).size))
      return { status: 'clarification_required', filters, query, clarification: ['Please include a searchable name or description.'], results: [], total: 0 };
    const matches = index.filter(({ record: r }) => {
      for (const key of ['source', 'record_type']) if (filters[key] && r[key] !== filters[key]) return false;
      for (const key of ['city', 'country']) if (filters[key] && normalize(r.location[key]) !== normalize(filters[key])) return false;
      if (filters.property_type && !words(r.property_type).has(stem(normalize(filters.property_type)))) return false;
      for (const key of ['transaction', 'currency', 'period']) if (filters[key] && normalize(r.offer[key]) !== normalize(filters[key])) return false;
      if (budget && (!Number.isFinite(r.offer.amount) || r.offer.amount < (filters.min_price ?? 0) || r.offer.amount > (filters.max_price ?? Infinity))) return false;
      if (filters.min_price_exclusive !== undefined && r.offer.amount <= filters.min_price_exclusive) return false;
      if (filters.max_price_exclusive !== undefined && r.offer.amount >= filters.max_price_exclusive) return false;
      if (filters.bedrooms !== undefined && !(r.record_type === 'project' ? r.bedrooms.options.includes(filters.bedrooms) : r.bedrooms.count === filters.bedrooms)) return false;
      if (filters.min_area !== undefined || filters.max_area !== undefined) {
        const low = r.area.sqm ?? r.area.range_sqm?.min;
        const high = r.area.sqm ?? r.area.range_sqm?.max;
        // Project ranges must fit entirely inside the requested bounds.
        if (!Number.isFinite(low) || !Number.isFinite(high) || low < (filters.min_area ?? 0) || high > (filters.max_area ?? Infinity)) return false;
      }
      if (filters.amenity && ![...words(filters.amenity)].every(term => words(r.amenities.join(' ')).has(term))) return false;
      return true;
    }).map(entry => ({ ...entry, score: terms.reduce((sum, term) => sum + (entry.title.has(term) ? 3 : entry.text.has(term) ? 1 : 0), 0) }))
      .filter(entry => !terms.length || terms.every(term => entry.text.has(term)))
      .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
    if (groupCities) {
      const cities = new Map();
      for (const { record } of matches) {
        const city = normalize(record.location.city).trim();
        if (!city) continue;
        if (!cities.has(city)) cities.set(city, { record, count: 0 });
        cities.get(city).count++;
      }
      const results = [...cities.values()].sort((a, b) => a.record.location.city.localeCompare(b.record.location.city));
      return { status: results.length ? 'matches' : 'no_matches', filters, query, total: matches.length, results };
    }
    return { status: matches.length ? 'matches' : 'no_matches', filters, query, total: matches.length,
      coverage: 'Results cover only the collected snapshot. Availability is unverified; possible duplicate listings are retained.',
      results: matches.slice(0, limit).map(({ record, score }) => ({ score, record })) };
  };
}
