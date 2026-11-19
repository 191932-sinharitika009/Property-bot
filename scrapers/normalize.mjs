import { load } from 'cheerio';

const number = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...nodes(value['@graph'])];
}
export function normalize(page) {
  const candidates = nodes(page.structured_data).filter(n =>
    ['SingleFamilyResidence', 'Apartment', 'House', 'Residence', 'Accommodation'].some(t =>
      (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).includes(t)));
  if (candidates.length !== 1) return { record: null, reason: 'Expected exactly one property entity; manual mapping required' };
  const entity = candidates[0];
  const $ = load(String(entity.description || ''));
  $('p,br,div').append('\n');
  const description = $.text().replace(/[ \t]+/g, ' ').trim();
  const offers = Array.isArray(entity.offers) ? entity.offers : entity.offers ? [entity.offers] : [];
  const offer = offers.length === 1 ? offers[0] : {};
  const currencyParts = String(offer.priceCurrency || '').trim().match(/^([A-Z]{3})(?:\s*\/\s*(Year|Month|Day|Week))?$/i);
  const currency = currencyParts?.[1].toUpperCase() || null;
  const pricePeriod = currencyParts?.[2]?.toLowerCase() || null;
  const price = number(offer.price);
  const priceText = description.match(/Price:\s*([\d,.]+)\s*([A-Z]{3})/i);
  const bedrooms = number(entity.numberOfBedrooms);
  const bedroomText = description.match(/(?:has|with)\s+(\d+)\s+bedrooms/i);
  const area = description.match(/(Land|Built[- ]?up|Floor) Area:\s*([\d,.]+)\s*(SQM|m2|m²)/i);
  const issues = [];
  if (priceText && price !== null && number(priceText[1]) !== price) issues.push('price_conflict');
  if (priceText && currency && priceText[2].toUpperCase() !== currency) issues.push('currency_conflict');
  if (bedroomText && bedrooms !== null && number(bedroomText[1]) !== bedrooms) issues.push('bedrooms_conflict');
  const title = entity.name || page.title;
  const type = title.match(/\b(Villa|Apartment|House|Land|Office|Building|Chalet|Floor)\b/i)?.[1]?.toLowerCase() || null;
  const transaction = /\/sale\//.test(page.source_url) ? 'sale' : /\/rent\//.test(page.source_url) ? 'rent' : null;
  // Only the inspected Wasalt primary summary, before descriptions/recommendations.
  const summary = page.source === 'wasalt' && page.text?.includes('Additional Information')
    ? page.text.split('Additional Information')[0] : '';
  const summaryArea = summary.match(/(?:^|\n)([\d,.]+) SQM\n(land area|built-up area|مساحة الأرض|مساحة البناء)\n([\d,]+)(?:\/(Year|Month|Week|Day))?/i);
  const areaValue = area ? number(area[2]) : summaryArea ? number(summaryArea[1]) : null;
  const areaType = area ? area[1].toLowerCase().replace(/[- ]/g, '_') : summaryArea ? (/land|الأرض/i.test(summaryArea[2]) ? 'land' : 'built_up') : null;
  if (summaryArea && area && number(summaryArea[1]) !== number(area[2])) issues.push('area_conflict');
  if (summaryArea && price !== null && number(summaryArea[3]) !== price) issues.push('visible_price_conflict');
  if (summaryArea?.[4] && pricePeriod && summaryArea[4].toLowerCase() !== pricePeriod) issues.push('rental_period_conflict');
  if (!currency) issues.push('currency_missing_or_invalid');
  if (!type) issues.push('property_type_missing');
  if (!transaction) issues.push('transaction_type_missing');
  if (areaValue === null) issues.push('area_missing');
  // Review heuristic only: preserve the published value rather than correcting it.
  if (type === 'apartment' && areaValue > 500) issues.push('unusually_large_apartment_area_review');
  if (price === null) issues.push('price_missing');
  if (!entity.address?.addressLocality) issues.push('city_missing');
  if (transaction === 'rent' && !pricePeriod) issues.push('rental_period_needs_review');
  // Deliberate allowlist: no agents, phone numbers, licenses, images or full-page text.
  const record = {
    id: page.id, source: page.source, source_url: page.source_url,
    scraped_at: page.scraped_at, record_type: 'property', title,
    city: entity.address?.addressLocality || null,
    district: entity.address?.streetAddress || null,
    country: entity.address?.addressCountry || null,
    property_type: type, transaction_type: transaction,
    price, currency, price_period: pricePeriod,
    bedrooms, area_sqm: areaValue,
    area_type: areaType,
    evidence: { entity_type: entity['@type'], price_text: priceText?.[0] || null,
      bedrooms_text: bedroomText?.[0] || null, area_text: area?.[0] || summaryArea?.[0]?.trim() || null,
      summary_area_text: summaryArea ? `${summaryArea[1]} SQM ${summaryArea[2]}` : null,
      price_currency_raw: offer.priceCurrency || null },
    validation: { status: issues.length ? 'needs_review' : 'checks_passed', issues },
    availability: 'not_verified'
  };
  return { record, reason: null };
}
