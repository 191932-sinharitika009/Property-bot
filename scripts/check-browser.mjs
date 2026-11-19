import { chromium } from 'playwright-core';
import { createServer } from '../server.mjs';
import assert from 'node:assert/strict';

// Local UI check uses a deterministic response; real provider tests are separate.
const server = createServer({ records: [], chat: async () => ({ status: 'answer', context: {},
  statements: [{ text: 'One, two and three bedroom options.', source_ids: ['test'] }],
  sources: [{ id: 'test', title: 'Les Vagues', url: 'https://darglobal.co.uk/les-vagues',
    source: 'darglobal', collected_at: '2026-11-19', quality: { warnings: [] } }] }) });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: 'Explore Les Vagues' }).click();
  await page.locator('.source-card').waitFor();
  assert.match(await page.locator('#messages').innerText(), /three bedroom/);
  assert.equal(await page.locator('.source-card').getAttribute('href'), 'https://darglobal.co.uk/les-vagues');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.locator('#welcome').waitFor({ state: 'visible' });
  await page.screenshot({ path: 'data/review/ui-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'data/review/ui-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: starter, answer, source link, reset, mobile width, no page errors.');
} finally {
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
