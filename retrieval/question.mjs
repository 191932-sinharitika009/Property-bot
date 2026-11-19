import { normalize, validateFilters } from './search.mjs';

// Deliberately bounded English parser. The structured search API is authoritative.
// Unrecognized words remain search terms rather than silently widening a query.
export function interpretQuestion(question, records, previous = {}) {
  if (typeof question !== 'string' || !question.trim() || question.length > 2000) throw new Error('Question must contain 1–2000 characters');
  validateFilters(previous.filters ?? {});
  const followup = /^(and\b|what about\b|only\b|under\b|below\b|with\b|instead\b)/i.test(question.trim());
  const filters = followup ? { ...previous.filters } : {};
  let text = normalize(question).replace(/-/g, ' ');
  const clarification = [];
  if (/\b(not|except|without|or)\b/.test(text)) clarification.push('Please express one positive set of filters per search; exclusions and alternatives are not supported yet.');
  function extract(pattern, key, value) {
    const found = [];
    text = text.replace(pattern, (...args) => { found.push(typeof value === 'function' ? value(args) : value); return ' '; });
    if (new Set(found).size > 1) clarification.push(`Please choose one ${key} per search.`);
    if (found.length) filters[key] = found[0];
  }
  // Match dataset geography, longest first; escape source text before using regex.
  for (const key of ['city', 'country']) {
    const values = [...new Set(records.map(r => r.location[key]).filter(Boolean))].sort((a, b) => b.length - a.length);
    const found = [];
    for (const value of values) {
      const escaped = normalize(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`\\b${escaped}\\b`, 'g'), () => { found.push(value); return ' '; });
    }
    if (found.length > 1) clarification.push(`Please choose one ${key} for this search.`);
    if (found.length) filters[key] = found[0];
  }
  extract(/\b(dar\s?global|wasalt)\b/g, 'source', m => m[1].replace(/\s/g, ''));
  extract(/\bprojects?\b/g, 'record_type', 'project');
  extract(/\blistings?\b/g, 'record_type', 'listing');
  extract(/\b(villas?|apartments?|land|floors?|penthouses?)\b/g, 'property_type', m => m[1].replace(/s$/, ''));
  const sale = /\b(sale|buy|purchase)\b/.test(text), rent = /\b(rent|rental|rentals)\b/.test(text);
  if (sale && rent) clarification.push('Please choose either sale or rent for this search.');
  extract(/\b(sale|buy|purchase)\b/g, 'transaction', 'sale');
  extract(/\b(rent|rental|rentals)\b/g, 'transaction', 'rent');
  if (sale && !rent) delete filters.period;
  extract(/\b(annual|annually|yearly|per year)\b/g, 'period', 'year');
  extract(/\b(monthly|per month)\b/g, 'period', 'month');
  if (filters.period && !filters.transaction) filters.transaction = 'rent';
  extract(/\b(\d+)\s*(?:bedrooms?|beds?|br)\b/g, 'bedrooms', m => Number(m[1]));
  const currencies = [...text.matchAll(/\b(SAR|AED|QAR|USD|EUR|GBP)\b/gi)].map(m => m[1].toUpperCase());
  if (new Set(currencies).size > 1) clarification.push('Please use one currency per search.');
  if (/[$€£]/.test(text)) clarification.push('Please specify a currency code, such as SAR or USD.');
  text = text.replace(/\b(SAR|AED|QAR|USD|EUR|GBP)\b/gi, ' ');
  if (currencies.length) filters.currency = currencies[0];
  text = text.replace(/\b(under|below|up to|at most|over|above|at least)\s*([\d,]+(?:\.\d+)?)\s*(million|thousand|m|k)?\b/g, ' ');
  // Re-read original normalized text for numeric bounds after removing currencies.
  const budgetText = normalize(question).replace(/\b(sar|aed|qar|usd|eur|gbp)\b/g, ' ');
  for (const m of budgetText.matchAll(/\b(under|below|up to|at most|over|above|at least)\s*([\d,]+(?:\.\d+)?)\s*(million|thousand|m|k)?\b/g)) {
    const amount = Number(m[2].replace(/,/g, '')) * ({ million: 1e6, m: 1e6, thousand: 1e3, k: 1e3 }[m[3]] ?? 1);
    const side = /over|above|at least/.test(m[1]) ? 'min' : 'max';
    delete filters[`${side}_price`];
    delete filters[`${side}_price_exclusive`];
    filters[`${side}_price${/under|below|over|above/.test(m[1]) ? '_exclusive' : ''}`] = amount;
  }
  if (/\b(?:swimming\s+)?pools?\b/.test(text) && /\bgyms?\b/.test(text)) clarification.push('Please search for one amenity at a time.');
  extract(/\b(?:swimming\s+)?pools?\b/g, 'amenity', 'pool');
  extract(/\bgyms?\b/g, 'amenity', 'gym');
  text = text.replace(/\b(show|find|me|please|what|which|are|is|the|a|an|in|for|with|and|of|have|has|do|does|tell|about|only|instead|options|bedrooms|bedroom|amenities|area|price|prices|cost|how|much|properties|property)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const query = text || (followup ? previous.query ?? '' : '');
  validateFilters(filters);
  return { filters, query, clarification, context: { filters, query } };
}

export function answerSearch(question, records, search, previous) {
  const interpreted = interpretQuestion(question, records, previous);
  if (interpreted.clarification.length) return { status: 'clarification_required', ...interpreted, results: [], total: 0 };
  return { ...search(interpreted), context: interpreted.context };
}
