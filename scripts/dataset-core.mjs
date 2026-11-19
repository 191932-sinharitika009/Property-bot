import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const countries = { 'Saudi Arabia': ['Saudi Arabia', 'SA'], KSA: ['Saudi Arabia', 'SA'], UAE: ['United Arab Emirates', 'AE'], 'United Arab Emirates': ['United Arab Emirates', 'AE'], Qatar: ['Qatar', 'QA'], Oman: ['Oman', 'OM'], Spain: ['Spain', 'ES'], 'United Kingdom': ['United Kingdom', 'GB'], England: ['United Kingdom', 'GB'] };
const restrictions = {
  area_conflict: ['area'], conflicting_area_ranges: ['area'], invalid_area_range: ['area'],
  unusually_large_apartment_area_review: ['area'], area_missing: ['area'], area_range_missing: ['area'],
  country_needs_review: ['country'], location_needs_review: ['city', 'country'], city_missing: ['city'],
  bedroom_options_needs_review: ['bedrooms'], bedrooms_conflict: ['bedrooms'], bedroom_range_needs_review: ['bedrooms'],
  amenities_not_extracted: ['amenities'], special_project_template_review: [],
  price_conflict: ['price'], visible_price_conflict: ['price'], price_missing: ['price'], published_price_needs_mapping: ['price'],
  currency_conflict: ['price', 'currency'], currency_missing_or_invalid: ['price', 'currency'],
  rental_period_conflict: ['price', 'price_period'], rental_period_needs_review: ['price', 'price_period'],
  property_type_missing: ['property_type'], transaction_type_missing: ['price', 'transaction_type']
};

export function curate(record, decision = null) {
  if (!['property', 'project'].includes(record.record_type)) throw new Error('Unsupported record type');
  const issues = record.validation?.issues || [];
  if (decision && decision.record_sha256 !== digest(record)) throw new Error(`Stale review for ${record.id}`);
  if (issues.length && !decision) throw new Error(`Review required for ${record.id}`);
  for (const issue of issues) if (!(issue in restrictions)) throw new Error(`Unknown validation issue: ${issue}`);
  const blocked = new Set(issues.flatMap(issue => restrictions[issue]));
  for (const field of decision?.blocked_fields || []) blocked.add(field);
  const sourceUrl = new URL(record.source_url);
  if (sourceUrl.protocol !== 'https:' || !['wasalt.sa', 'darglobal.co.uk'].includes(sourceUrl.hostname)) throw new Error('Unexpected source URL');
  if (!record.title || !record.scraped_at) throw new Error('Missing source identity or collection date');
  const isListing = record.record_type === 'property';
  const country = blocked.has('country') ? null : countries[record.country] || null;
  const city = blocked.has('city') ? null : record.city || null;
  const areaBlocked = blocked.has('area');
  // Listing titles can repeat an uncertain area. Keep the raw title in the source
  // dataset, but do not leak it into the curated display/search title.
  let title = areaBlocked ? record.title.replace(/\b[\d,.]+\s*(?:SQM|sq\.?\s*m|m²)(?=\s|$)/gi, '[area under review]') : record.title;
  if (blocked.has('bedrooms')) title = title.replace(/\b\d+\s*[- ]?bedrooms?\b/gi, '[bedrooms under review]');
  const warnings = [...issues, ...(decision?.warnings || [])];
  if (decision?.duplicate_group) warnings.push('possible_duplicate_listing');
  return {
    schema_version: 1, id: `${record.source}:${record.id}`, source: record.source,
    record_type: isListing ? 'listing' : 'project', source_url: record.source_url,
    collected_at: record.scraped_at, normalized_input_sha256: digest(record), title,
    collection_method: record.collection_method || 'http_scraper',
    location: { city, district: record.district || null, country: country?.[0] || null, country_code: country?.[1] || null,
      as_published: record.location_as_published || null },
    property_type: blocked.has('property_type') ? null : record.property_type || null,
    status_as_published: record.status_as_published || null,
    offer: { transaction: blocked.has('transaction_type') ? null : record.transaction_type || null,
      amount: blocked.has('price') ? null : record.price ?? null,
      currency: blocked.has('currency') ? null : record.currency || null,
      period: blocked.has('price_period') ? null : record.price_period || null },
    bedrooms: { count: isListing && !blocked.has('bedrooms') ? record.bedrooms ?? null : null,
      options: !isListing && !blocked.has('bedrooms') ? record.bedroom_options || [] : [] },
    area: { sqm: areaBlocked ? null : record.area_sqm ?? null,
      range_sqm: areaBlocked ? null : record.area_range_sqm || null, kind: record.area_type || null, unit: 'sqm' },
    amenities: blocked.has('amenities') ? [] : record.amenities || [],
    availability: 'not_verified',
    quality: { status: warnings.length ? 'usable_with_caveats' : 'checks_passed', warnings: [...new Set(warnings)],
      blocked_fields: [...blocked].sort(), review_note: decision ? 'Saved source reviewed. Use only nonblocked structured fields; detailed evidence is in the review decisions.' : null,
      duplicate_group: decision?.duplicate_group || null },
    // Deliberately no raw text, HTML, agent fields, or conflicting numeric claims.
    search_text: [title, city, country?.[0], record.property_type, ...(blocked.has('amenities') ? [] : record.amenities || [])].filter(Boolean).join(' | ')
  };
}
