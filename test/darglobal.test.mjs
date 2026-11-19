import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { projectUrl, discoverProjects, classifyResult, challengeDetected, parseProject } from '../scrapers/darglobal-core.mjs';
import { enqueue, loadState, atomicJson, exportRecords } from '../scrapers/darglobal-store.mjs';

const fixture = `<html><head><title>Example residences</title><script src="recaptcha.js"></script>
<script type="application/ld+json">{"@graph":[{"@type":"FAQPage","mainEntity":[{"name":"What unit sizes are available?","acceptedAnswer":{"text":"Residences range from 86 to 389 sqm."}}]}]}</script></head>
<body><h1>Example residences</h1><p>Doha | Qatar</p><ul>
<li><span>Property Type</span><span>Apartments</span></li>
<li><span>Status</span><span>Under Development</span></li>
<li><span>Unit Type</span><span>1, 2 &amp; 3-bedrooms</span></li>
<li><span>Area (SQM)</span><span>84 - 383</span></li></ul>
<h2>Amenities</h2><div class="style_AmenitiesListItem_xyz"><span>Pool</span></div>
<p>Golden Visa with an investment of $200,000</p></body></html>`;

test('URL scope rejects external, account, localized and policy links', () => {
  assert.equal(projectUrl('https://other.example/project'), null);
  assert.equal(projectUrl('/privacy-policy'), null);
  assert.equal(projectUrl('/ar/les-vagues'), null);
  assert.equal(projectUrl('/les-vagues/?utm_source=example#x'), 'https://darglobal.co.uk/les-vagues');
});
test('directory discovery deduplicates and excludes navigation', () => {
  const html = '<nav><a href="/unwanted">Navigation content here</a></nav><a href="/les-vagues"><h3>Les Vagues</h3></a><a href="/les-vagues#x"><h3>Again</h3></a><a href="https://other.example/x"><h3>Other</h3></a>';
  assert.equal(discoverProjects(html).length, 1);
});
test('challenge detection does not reject an ordinary form CAPTCHA script', () => {
  assert.equal(challengeDetected({ html: fixture, title: 'Example', text: 'Ordinary project details '.repeat(30) }), false);
  assert.equal(challengeDetected({ html: '<script src="/_Incapsula_Resource"></script>', text: '' }), true);
});
test('HTTP 200 challenge stops; 429 stops; transient 503 retries; 404 does not', () => {
  assert.equal(classifyResult({ status: 200, challenge: true, readable: true }).stop, true);
  assert.equal(classifyResult({ status: 429 }).stop, true);
  assert.equal(classifyResult({ status: 503 }).retry, true);
  assert.equal(classifyResult({ status: 404 }).retry, false);
  assert.equal(classifyResult({ status: 200, readable: false }).retry, false);
  assert.equal(classifyResult({ status: 200, readable: true, navigationError: 'timeout' }).status, 'readable');
});
test('project parser keeps conflicts and does not turn visa amounts into prices', () => {
  const { record } = parseProject(fixture, 'https://darglobal.co.uk/example', '2026-11-19T00:00:00Z');
  assert.equal(record.city, 'Doha');
  assert.equal(record.country, 'Qatar');
  assert.deepEqual(record.bedroom_options, [1, 2, 3]);
  assert.equal(record.price, null);
  assert.equal(record.area_range_sqm, null);
  assert.equal(record.area_claims.length, 2);
  assert.ok(record.validation.issues.includes('conflicting_area_ranges'));
  assert.deepEqual(record.amenities, ['Pool']);
});
test('unsupported templates and restrictive directives are not accepted as projects', () => {
  assert.equal(parseProject('<h1>News</h1>', 'https://darglobal.co.uk/news').record, null);
  assert.equal(parseProject(fixture.replace('<head>', '<head><meta name="robots" content="noindex">'), 'https://darglobal.co.uk/example').reason, 'restrictive_page_directive');
});
test('uppercase labels, Units alias, bedroom ranges and square feet are preserved', () => {
  const html = fixture.replace('Unit Type', 'Units').replace('1, 2 &amp; 3-bedrooms', '1 to 3-bedroom residences')
    .replace('Area (SQM)', 'AREA (SQFT)').replace('84 - 383', '1,000 - 2,000');
  const { record } = parseProject(html, 'https://darglobal.co.uk/example');
  assert.deepEqual(record.bedroom_options, [1, 2, 3]);
  assert.equal(record.area_claims[0].original_unit, 'sqft');
  assert.equal(record.area_claims[0].min, 92.9);
  assert.equal(record.area_range_sqm, null);
  assert.equal(record.validation.issues.includes('bedroom_range_needs_review'), false);
});
test('special project layout retains sparse evidence without inventing a price', () => {
  const html = '<h1>Sample Penthouse</h1><p>Dubai | UAE</p><section><h2>Overview</h2><p>This residence is spanning 14,768 sqft and has spacious living rooms overlooking the city.</p></section><section><h2>Location</h2><p>This penthouse is located near the canal with access to local restaurants and shopping.</p></section><p>SOLD OUT</p>';
  const { record } = parseProject(html, 'https://darglobal.co.uk/one-of-one/sample');
  assert.equal(record.area_sqm, 1371.99);
  assert.equal(record.price, null);
  assert.equal(record.status_as_published, 'Sold out');
  assert.equal(record.validation.status, 'needs_review');
  assert.equal(record.content_sections.length, 2);
});
test('a regional label is not silently interpreted as a country', () => {
  const { record } = parseProject(fixture.replace('Doha | Qatar', 'Al Marjan Island | RAK'), 'https://darglobal.co.uk/example');
  assert.equal(record.country, null);
  assert.equal(record.location_as_published, 'Al Marjan Island | RAK');
  assert.ok(record.validation.issues.includes('country_needs_review'));
});
test('amenity fallback uses only matching project metadata and excludes false values', () => {
  const metadata = { '@type': 'RealEstateListing', url: 'https://darglobal.co.uk/example', mainEntity: { amenityFeature: [{ name: 'Gym' }, { name: 'Pool', value: false }] } };
  const html = fixture.replace('<h2>Amenities</h2>', '<h2>Features</h2>').replace('</head>', `<script type="application/ld+json">${JSON.stringify(metadata)}</script></head>`);
  const { record } = parseProject(html, 'https://darglobal.co.uk/example');
  assert.deepEqual(record.amenities, ['Gym']);
  assert.equal(record.evidence.amenities_source, 'project_JSON_LD_amenityFeature');
});
test('restart preserves success, requeues interrupted entries, and refuses corrupted state', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'darglobal-state-'));
  try {
    const state = await loadState(folder);
    enqueue(state, [{ url: 'https://darglobal.co.uk/a' }, { url: 'https://darglobal.co.uk/a' }, { url: 'https://darglobal.co.uk/b' }]);
    assert.equal(state.entries.length, 2);
    state.entries[0].status = 'collected';
    state.entries[0].record = { id: 'a', validation: { status: 'checks_passed' } };
    state.entries[1].status = 'in_progress';
    await atomicJson(join(folder, 'state.json'), state);
    const resumed = await loadState(folder);
    assert.equal(resumed.entries[0].status, 'collected');
    assert.equal(resumed.entries[1].status, 'pending');
    await exportRecords(folder, resumed);
    assert.equal((await readFile(join(folder, 'projects.jsonl'), 'utf8')).trim().split('\n').length, 1);
    await writeFile(join(folder, 'state.json'), '{broken');
    await assert.rejects(loadState(folder));
  } finally {
    // Exactly the temporary directory allocated above, never the project data.
    const target = await realpath(folder);
    const tempRoot = await realpath(tmpdir());
    assert.ok(target.startsWith(tempRoot + sep));
    await rm(target, { recursive: true, force: true });
  }
});
