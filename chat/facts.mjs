import { safeRecord } from '../retrieval/search.mjs';

export const factFields = ['location', 'type', 'status', 'bedrooms', 'area', 'price', 'amenities', 'availability'];

export function propertyStatement(record, fields) {
  const r = safeRecord(record);
  const place = [r.location.city, r.location.country].filter(Boolean).join(', ');
  const bedrooms = r.bedrooms.options?.length ? r.bedrooms.options.join(', ') : r.bedrooms.count;
  const range = r.area.range_sqm;
  const amount = r.offer.amount;
  const period = r.offer.period ? ' per ' + r.offer.period : '';
  const facts = {
    location: place ? 'Location: ' + place + '.' : 'Location is unconfirmed.',
    type: r.property_type ? 'Property type: ' + r.property_type + '.' : 'Property type is unconfirmed.',
    status: r.status_as_published ? 'Published status: ' + r.status_as_published + '.' : 'Development status is unconfirmed.',
    bedrooms: bedrooms == null ? 'Bedroom information is unconfirmed.' : 'Bedrooms: ' + bedrooms + '.',
    area: Number.isFinite(r.area.sqm) ? `Area: ${r.area.sqm} m².` :
      Number.isFinite(range?.min) && Number.isFinite(range?.max) ? `Area: ${range.min}–${range.max} m².` :
      r.quality.warnings?.includes('conflicting_area_ranges') ? 'The source gives conflicting area ranges.' : 'Area is unconfirmed.',
    price: Number.isFinite(amount) ? `Published ${r.offer.transaction === 'rent' ? 'rent' : 'price'}: ${amount.toLocaleString('en-US')} ${r.offer.currency ?? '(currency unconfirmed)'}${period}.` : 'Price is unconfirmed.',
    amenities: r.amenities.length ? (r.record_type === 'project' ? 'Published project amenities: ' : 'Recorded listing amenities: ') + r.amenities.join(', ') + (r.record_type === 'project' ? '. Individual unit amenities are unverified.' : '.') : 'Amenities are unconfirmed.',
    availability: 'Current availability is unverified.',
  };
  return { text: [r.title + '.', ...new Set(fields.map(field => facts[field]))].join(' '), source_ids: [r.id] };
}
