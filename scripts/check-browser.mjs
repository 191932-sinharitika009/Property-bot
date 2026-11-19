import { chromium } from 'playwright-core';
import { createServer } from '../server.mjs';
import assert from 'node:assert/strict';
import { loadRecords } from '../retrieval/search.mjs';
import { createChat } from '../chat/answer.mjs';
import { loadStarterCache, STARTERS } from '../chat/starter-cache.mjs';
import { DEFAULT_MODEL } from '../chat/openrouter.mjs';

// All four real saved answers must render with no provider request.
const records = await loadRecords();
const server = createServer({ records, chat: createChat(records, { model: DEFAULT_MODEL,
  starterCache: await loadStarterCache(), completeImpl: () => assert.fail('Starter attempted a model call') }) });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const question of STARTERS) {
    await page.locator('[data-question]').filter({ hasText: '' }).evaluateAll((buttons, q) => buttons.find(b => b.dataset.question === q).click(), question);
    await page.locator('.source-card').first().waitFor();
    assert.match(await page.locator('#messages').innerText(), /Saved answer/);
    assert.equal(await page.locator('.message.error').count(), 0);
    await page.getByRole('button', { name: 'New conversation' }).click();
    await page.locator('#welcome').waitFor({ state: 'visible' });
  }
  await page.screenshot({ path: 'data/review/ui-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'data/review/ui-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: all four saved starters, source cards, reset, mobile width, no page errors or model calls.');
} finally {
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
