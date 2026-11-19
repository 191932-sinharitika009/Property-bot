import test from 'node:test';
import assert from 'node:assert/strict';
import robotsParser from 'robots-parser';
import { extract, isChallenge } from '../scrapers/extract.mjs';

test('extracts readable multilingual content without inventing property attributes', () => {
  const result = extract(`<html><head><title>Listing</title><script type="application/ld+json">{"@type":"Product","name":"Apartment"}</script></head><body><nav>Menu</nav><main><h1>شقة في الرياض</h1><p>Apartment &amp; balcony</p><a href="/en/project#details">Details</a><script>secretCode()</script></main><footer>Footer</footer></body></html>`, 'https://wasalt.sa/en/listing', 'wasalt');
  assert.equal(result.record.title, 'شقة في الرياض');
  assert.match(result.record.text, /Apartment & balcony/);
  assert.doesNotMatch(result.record.text, /Menu|Footer|secretCode/);
  assert.equal(result.record.price, null);
  assert.equal(result.record.structured_data[0].name, 'Apartment');
  assert.deepEqual(result.links, ['https://wasalt.sa/en/project']);
});

test('identifies anti-bot responses', () => {
  assert.ok(isChallenge('<script src="/_Incapsula_Resource"></script>'));
  assert.ok(isChallenge('<title>Just a moment...</title>'));
  assert.equal(isChallenge('<h1>Apartment in Riyadh</h1>'), false);
});

test('does not inherit exceptions for named AI bots', () => {
  const rules = robotsParser('https://wasalt.sa/robots.txt', 'User-agent: ChatGPT-User\nAllow: /search\n\nUser-agent: *\nAllow: /\nDisallow: /search');
  assert.equal(rules.isAllowed('https://wasalt.sa/search', 'PropertyAssignmentBot'), false);
  assert.equal(rules.isAllowed('https://wasalt.sa/en/property/123', 'PropertyAssignmentBot'), true);
});
