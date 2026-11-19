import { load } from 'cheerio';
import { createHash } from 'node:crypto';

export function isChallenge(html) {
  return /_Incapsula_Resource|cf-chl-|verify you are human|captcha|access denied|just a moment/i.test(html);
}

export function extract(html, url, source) {
  const $ = load(html);
  const structured = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try { structured.push(JSON.parse($(el).text())); } catch { /* Invalid publisher JSON is optional. */ }
  });
  const links = [];
  $('a[href]').each((_, el) => {
    try {
      const next = new URL($(el).attr('href'), url);
      next.hash = '';
      if (next.origin === new URL(url).origin && !next.search) links.push(next.href);
    } catch { /* Skip invalid links. */ }
  });
  const title = $('h1').first().text().trim() || $('title').text().trim();
  const description = $('meta[name="description"]').attr('content')?.trim() || null;
  const robots = $('meta[name="robots"]').attr('content') || '';
  $('script,style,noscript,nav,header,footer,form,iframe,svg,button').remove();
  const container = $('main').length ? $('main') : $('body');
  container.find('p,div,section,li,h1,h2,h3,br,tr').append('\n');
  const text = container.text().split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return {
    record: {
      id: createHash('sha256').update(url).digest('hex').slice(0, 16),
      source, source_url: url, scraped_at: new Date().toISOString(),
      record_type: 'page', title, description, text,
      city: null, property_type: null, transaction_type: null,
      price: null, currency: null, bedrooms: null, area_sqm: null,
      // Structured data is preserved as evidence; field normalization is a separate step.
      structured_data: structured,
      quality: 'raw_extraction_needs_review'
    },
    links: [...new Set(links)], robots
  };
}
