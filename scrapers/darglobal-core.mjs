import { load } from 'cheerio';
import { createHash } from 'node:crypto';

export const ORIGIN = 'https://darglobal.co.uk';
export const PARSER_VERSION = 3;
export const idFor = url => createHash('sha256').update(url).digest('hex').slice(0, 16);
export function projectUrl(value, base = ORIGIN) {
  try {
    const u = new URL(value, base);
    if (u.origin !== ORIGIN || u.username || u.password) return null;
    u.hash = ''; u.search = '';
    const path = u.pathname.replace(/\/+$/, '') || '/';
    if (/^\/(?:$|ar(?:\/|$)|projects$|privacy|terms|contact|about|news|blog|investor|product-category|register|login|api|_next)/i.test(path)) return null;
    if (/\.(pdf|jpg|png|svg|webp|zip)$/i.test(path)) return null;
    return ORIGIN + path;
  } catch { return null; }
}
export function discoverProjects(html) {
  const $ = load(html);
  $('header,footer,nav,form').remove();
  const found = new Map();
  $('a[href]').each((_, element) => {
    const link = $(element);
    const url = projectUrl(link.attr('href'));
    const label = link.text().replace(/\s+/g, ' ').trim();
    if (url && label.length > 3 && (link.find('img,h2,h3,h4').length || label.length > 15)) {
      found.set(url, { url, label: label.slice(0, 250) });
    }
  });
  return [...found.values()];
}
export function challengeDetected({ html = '', text = '', title = '', frames = [] }) {
  return /^(?:just a moment|access denied|request unsuccessful|pardon our interruption)/i.test(title.trim())
    || /verify (?:that )?you are human|please complete the security check|request unsuccessful.*incident/i.test(text)
    || (/_Incapsula_Resource|cf-chl-/.test(html) && text.trim().length < 300)
    || (text.trim().length < 300 && frames.some(src => /captcha|challenge|_Incapsula_Resource/i.test(src)));
}
export function classifyResult({ status, challenge, navigationError, readable }) {
  if (challenge || status === 401 || status === 403) return { status: 'blocked', retry: false, stop: true };
  if (status === 429) return { status: 'rate_limited', retry: false, stop: true };
  if (status >= 500) return { status: 'server_error', retry: true, stop: false };
  if (status >= 400) return { status: 'http_error', retry: false, stop: false };
  if (readable && status >= 200 && status < 300) return { status: 'readable', retry: false, stop: false };
  if (navigationError) return { status: 'navigation_failed', retry: true, stop: false };
  // A completed HTTP response with an unknown layout is not a transient network error.
  return { status: 'insufficient_content', retry: false, stop: false };
}
function flatNodes(value) {
  if (Array.isArray(value)) return value.flatMap(flatNodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...flatNodes(value['@graph'])];
}
function contentSections($) {
  const sections = [];
  $('h2').each((_, heading) => {
    let container = $(heading).parent();
    for (let level = 0; level < 5 && container.length; level++, container = container.parent()) {
      if (container.find('h2').length > 1) break;
      const text = container.find('p').map((_, e) => $(e).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean).join(' ');
      if (text.length > 50) {
        const title = $(heading).text().trim();
        if (!/privacy|cookie|register|interest/i.test(title)) sections.push({ heading: title, text: text.slice(0, 1800) });
        break;
      }
    }
  });
  return sections.slice(0, 12);
}
function specialProject($, url, collectedAt, title, locationParts, location) {
  if (!new URL(url).pathname.startsWith('/one-of-one/')) return null;
  const sections = contentSections($);
  if (!title || sections.length < 2) return null;
  const text = sections.map(s => s.text).join('\n');
  const area = text.match(/(?:spanning|area of|extends over)\s+([\d,.]+)\s*(sqft|sqm)/i);
  const value = area ? Number(area[1].replaceAll(',', '')) : null;
  const sqm = value === null ? null : area[2].toLowerCase() === 'sqft' ? Number((value * 0.09290304).toFixed(2)) : value;
  const bedroom = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight)\s+(?:luxurious\s+)?bedrooms?\b/i);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const bedroomCount = bedroom ? words[bedroom[1].toLowerCase()] || Number(bedroom[1]) : null;
  const country = /^(UAE|United Arab Emirates|Qatar|Oman|Spain|United Kingdom|England|Saudi Arabia|KSA)$/i.test(locationParts[1] || '') ? locationParts[1] : null;
  $('script,style,noscript,form,header,footer,nav').remove();
  const bodyText = $('body').text();
  const issues = ['special_project_template_review'];
  if (!country) issues.push('country_needs_review');
  if (sqm === null) issues.push('area_missing');
  return {
    id: idFor(url), source: 'darglobal', source_url: url, scraped_at: collectedAt,
    collection_method: 'playwright_visible_chrome', parser_version: PARSER_VERSION,
    record_type: 'project', title, city: locationParts[0] || null, country,
    location_as_published: locationParts.length ? location : null,
    property_type: /penthouse/i.test(title) ? 'penthouse' : /villas?/i.test(title) ? 'villa' : null,
    status_as_published: /sold out/i.test(bodyText) ? 'Sold out' : /join the waiting list/i.test(bodyText) ? 'Waiting list' : null,
    bedroom_options: bedroomCount ? [bedroomCount] : [], unit_types_as_published: null,
    area_sqm: sqm, area_range_sqm: null, area_claims: [],
    price: null, currency: null, price_as_published: null, amenities: [],
    content_sections: sections, completion_as_published: null, availability: 'not_verified',
    evidence: { area_text: area?.[0] || null, bedrooms_text: bedroom?.[0] || null },
    validation: { status: 'needs_review', issues }
  };
}
export function parseProject(html, url, collectedAt = new Date().toISOString()) {
  const $ = load(html);
  const robots = $('meta[name="robots"]').attr('content') || '';
  if (/noindex|noarchive|nosnippet/i.test(robots)) return { record: null, reason: 'restrictive_page_directive' };
  const title = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const fields = {};
  $('li').each((_, el) => {
    const spans = $(el).find('span');
    if (spans.length === 2) {
      const key = spans.eq(0).text().trim();
      if (/^(Property Type|Status|Unit Type|Units|Area \((?:SQM|SQFT)\)|Price|Starting Price)$/i.test(key)) fields[key.toLowerCase() === 'units' ? 'unit type' : key.toLowerCase()] = spans.eq(1).text().trim();
    }
  });
  const structured = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try { structured.push(...flatNodes(JSON.parse($(el).text()))); } catch {}
  });
  const listing = structured.find(n => n['@type'] === 'RealEstateListing' && n.url === url);
  const metadataAmenities = (listing?.mainEntity?.amenityFeature || [])
    .filter(n => typeof n.name === 'string' && n.value !== false)
    .map(n => n.name.trim()).filter(Boolean);
  const faq = structured.filter(n => n['@type'] === 'FAQPage').flatMap(n => n.mainEntity || [])
    .filter(n => n.name && n.acceptedAnswer?.text)
    .map(n => ({ question: load(String(n.name)).text().trim(), answer: load(String(n.acceptedAnswer.text)).text().trim() }));
  // Also support ordinary rendered FAQ cards when JSON-LD is missing.
  if (!faq.length) $('h3').each((_, el) => {
    const question = $(el).text().trim();
    if (/\?$/.test(question)) {
      const answer = $(el).parent().parent().find('p').first().text().trim();
      if (answer) faq.push({ question, answer });
    }
  });
  const location = $('h1').first().nextAll().first().text().replace(/\s+/g, ' ').trim();
  const locationParts = location.length < 150 && location.includes('|') ? location.split('|').map(s => s.trim()) : [];
  const issues = [];
  const propertyType = fields['property type'] || null;
  if (!title || !propertyType || !fields['unit type']) {
    const special = specialProject($, url, collectedAt, title, locationParts, location);
    return special ? { record: special, reason: null } : { record: null, reason: 'unsupported_project_template' };
  }
  const bedroomText = fields['unit type'];
  const bedrooms = /bedroom/i.test(bedroomText) ? [...new Set((bedroomText.match(/\b\d+\b/g) || []).map(Number))] : [];
  for (const m of bedroomText.matchAll(/\b(\d+)\s*(?:to|[-–])\s*(\d+)\s*[- ]?bedroom/gi)) {
    const [min, max] = [Number(m[1]), Number(m[2])];
    if (min > 0 && max >= min && max <= 20) {
      for (let n = min; n <= max; n++) if (!bedrooms.includes(n)) bedrooms.push(n);
    } else issues.push('bedroom_range_needs_review');
  }
  bedrooms.sort((a, b) => a - b);
  const claims = [];
  const summaryRange = fields['area (sqm)']?.match(/^([\d,.]+)\s*[-–]\s*([\d,.]+)$/);
  const numeric = s => Number(s.replaceAll(',', ''));
  if (summaryRange) claims.push({ section: 'project summary', min: numeric(summaryRange[1]), max: numeric(summaryRange[2]) });
  const sqft = fields['area (sqft)']?.match(/^([\d,.]+)\s*[-–]\s*([\d,.]+)$/);
  if (sqft) claims.push({ section: 'project summary converted from square feet',
    min: Number((numeric(sqft[1]) * 0.09290304).toFixed(2)), max: Number((numeric(sqft[2]) * 0.09290304).toFixed(2)),
    original_unit: 'sqft', original_min: numeric(sqft[1]), original_max: numeric(sqft[2]) });
  for (const item of faq) {
    if (!/size|unit types|area/i.test(item.question)) continue;
    for (const m of item.answer.matchAll(/(?:from\s+)?([\d,.]+)\s*(?:to|[-–])\s*([\d,.]+)\s*(?:sqm|sq\.?\s*m|square met(?:er|re)s)/gi)) {
      claims.push({ section: item.question, min: numeric(m[1]), max: numeric(m[2]) });
    }
  }
  if (claims.some(c => !Number.isFinite(c.min) || !Number.isFinite(c.max) || c.min <= 0 || c.min > c.max)) issues.push('invalid_area_range');
  const ranges = new Set(claims.map(c => `${c.min}:${c.max}`));
  if (ranges.size > 1) issues.push('conflicting_area_ranges');
  if (!claims.length) issues.push('area_range_missing');
  if (!locationParts.length) issues.push('location_needs_review');
  const country = /^(UAE|United Arab Emirates|Qatar|Oman|Spain|United Kingdom|England|Saudi Arabia|KSA)$/i.test(locationParts[1] || '') ? locationParts[1] : null;
  if (!country) issues.push('country_needs_review');
  if (!bedrooms.length) issues.push('bedroom_options_needs_review');
  const amenitiesHeading = $('h2').filter((_, e) => /^amenities(?: of|$)/i.test($(e).text().trim())).first();
  let amenities = [];
  if (amenitiesHeading.length) {
    const section = amenitiesHeading.closest('section');
    const knownItems = $('[class*="AmenitiesListItem"] span');
    const items = knownItems.length ? knownItems : section.find('li');
    amenities = [...new Set(items.map((_, e) => $(e).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean))];
  }
  const amenitiesSource = amenities.length ? 'rendered_page' : metadataAmenities.length ? 'project_JSON_LD_amenityFeature' : null;
  if (!amenities.length && metadataAmenities.length) amenities = [...new Set(metadataAmenities)];
  if (!amenities.length) issues.push('amenities_not_extracted');
  // No broad currency regex: marketing/visa investment amounts are NOT unit prices.
  const publishedPrice = fields['starting price'] || fields.price || null;
  if (publishedPrice) issues.push('published_price_needs_mapping');
  const completion = faq.filter(f => /complet|handover/i.test(f.question)).map(f => f.answer.match(/(?:scheduled for|completion in|completed in|handover in)\s+([A-Za-z]+\s+20\d{2}|Q[1-4]\s+20\d{2}|20\d{2})/i)?.[1]).filter(Boolean);
  return { reason: null, record: {
    id: idFor(url), source: 'darglobal', source_url: url, scraped_at: collectedAt,
    collection_method: 'playwright_visible_chrome', parser_version: PARSER_VERSION,
    record_type: 'project', title, city: locationParts[0] || null, country,
    location_as_published: locationParts.length ? location : null,
    property_type: propertyType, status_as_published: fields.status || null,
    bedroom_options: bedrooms, unit_types_as_published: bedroomText,
    area_range_sqm: claims.length && !issues.some(i => /area/.test(i)) ? { min: claims[0].min, max: claims[0].max } : null,
    area_claims: claims, price: null, currency: null, price_as_published: publishedPrice,
    amenities, completion_as_published: completion[0] || null,
    availability: 'not_verified', evidence: { summary_fields: fields, completion_claims: completion, amenities_source: amenitiesSource },
    validation: { status: issues.length ? 'needs_review' : 'checks_passed', issues }
  } };
}
