import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extract } from './extract.mjs';

const target = 'https://darglobal.co.uk/les-vagues';
const folder = new URL(`../data/runs/diagnostic-${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url);
await mkdir(folder, { recursive: true });
const report = { target, started_at: new Date().toISOString(), method: 'visible Chrome, fresh context, no challenge bypass', records_collected: 0, network: [], failures: [] };
let browser, page;
const cleanUrl = value => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return 'invalid URL'; } };
const bounded = (promise, ms = 5000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Diagnostic capture timeout')), ms); })]).finally(() => clearTimeout(timer));
};
try {
  browser = await chromium.launch({ channel: 'chrome', headless: false, timeout: 30000 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('response', response => {
    const type = response.request().resourceType();
    if (['document', 'xhr', 'fetch'].includes(type) && report.network.length < 100) {
      report.network.push({ url: cleanUrl(response.url()), status: response.status(), type,
        content_type: response.headers()['content-type'] || null });
    }
  });
  page.on('requestfailed', request => {
    if (report.failures.length < 30) report.failures.push({ url: cleanUrl(request.url()), type: request.resourceType(), error: request.failure()?.errorText });
  });
  // 'commit' separates receiving a document from waiting on its scripts.
  try {
    const response = await page.goto(target, { waitUntil: 'commit', timeout: 30000 });
    report.http_status = response?.status() ?? null;
  } catch (error) { report.navigation_error = error.message; }
  let snapshot;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      snapshot = await bounded(page.evaluate(() => ({ title: document.title, text: document.body?.innerText || '', html: document.documentElement.outerHTML,
        frame_sources: [...document.querySelectorAll('iframe')].map(f => f.getAttribute('src') || '') })));
      const challenge = /verify (?:that )?you are human|access denied|just a moment|security check|request unsuccessful|incident id|pardon our interruption/i.test(snapshot.title + '\n' + snapshot.text)
        || (/_Incapsula_Resource/.test(snapshot.html) && snapshot.text.trim().length < 200)
        || snapshot.frame_sources.some(u => /captcha|challenge|_Incapsula_Resource/i.test(u));
      if (challenge) { report.result = 'access_challenge'; break; }
      if (/les vagues/i.test(snapshot.title + snapshot.text) && snapshot.text.length > 500) {
        report.result = 'project_content_readable'; break;
      }
    } catch (error) { report.capture_error = error.message; }
    await page.waitForTimeout(2000);
  }
  if (snapshot) {
    report.title = snapshot.title;
    report.visible_characters = snapshot.text.length;
    await writeFile(new URL('response.html', folder), snapshot.html);
    await writeFile(new URL('visible-text.txt', folder), snapshot.text);
    if (report.result === 'project_content_readable') {
      const { record, robots } = extract(snapshot.html, target, 'darglobal');
      if (/noindex|noarchive|nosnippet/i.test(robots)) report.result = 'restrictive_page_directive';
      else {
        await writeFile(new URL('pages.jsonl', folder), JSON.stringify(record) + '\n');
        report.records_collected = 1;
      }
    }
  }
  report.result ||= report.navigation_error ? 'navigation_failed' : 'insufficient_project_content';
} catch (error) { report.result = 'browser_error'; report.error = error.message; }
finally {
  if (page) {
    report.final_url = cleanUrl(page.url());
    try { await page.screenshot({ path: fileURLToPath(new URL('page.png', folder)), timeout: 5000 }); }
    catch (error) { report.screenshot_error = error.message; }
  }
  report.finished_at = new Date().toISOString();
  await writeFile(new URL('report.json', folder), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  console.log(JSON.stringify({ result: report.result, records_collected: report.records_collected,
    http_status: report.http_status, title: report.title, visible_characters: report.visible_characters,
    network_responses: report.network.length, request_failures: report.failures.length, output: fileURLToPath(folder) }, null, 2));
}
