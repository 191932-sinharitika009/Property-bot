import { chromium } from 'playwright-core';
import robotsParser from 'robots-parser';
import { load } from 'cheerio';
import { readFile, writeFile, mkdir, open, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ORIGIN, projectUrl, idFor, discoverProjects, challengeDetected, classifyResult, parseProject } from './darglobal-core.mjs';
import { atomicJson, loadState, enqueue, exportRecords } from './darglobal-store.mjs';

const args = process.argv.slice(2);
const valueFlags = new Set(['--limit', '--urls']);
const switches = new Set(['--headless', '--discover', '--retry-failed', '--resume-after-stop']);
for (let i = 0; i < args.length; i++) {
  if (valueFlags.has(args[i])) {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${args[i]}`);
    i++;
  } else if (!switches.has(args[i])) throw new Error(`Unknown argument ${args[i]}`);
}
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const limit = Number(value('--limit', '5'));
if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('--limit must be 1..50');
const folder = fileURLToPath(new URL('../data/darglobal/crawl/', import.meta.url));
await mkdir(join(folder, 'raw'), { recursive: true });
let lock;
try { lock = await open(join(folder, '.lock'), 'wx'); }
catch (error) { if (error.code === 'EEXIST') throw new Error('Crawler lock exists. Check for a running crawler before removing data/darglobal/crawl/.lock.'); throw error; }
await lock.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
let browser, state, run, stopping = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
const save = async () => { await atomicJson(join(folder, 'state.json'), state); await exportRecords(folder, state); };
function bounded(promise, timeout = 5000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Capture timed out')), timeout); })]).finally(() => clearTimeout(timer));
}
async function visit(context, url, directory = false) {
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const result = { url, attempted_at: new Date().toISOString(), status_code: null, failures: [] };
  let snapshot = null;
  page.on('requestfailed', request => {
    if (request.isNavigationRequest() && result.failures.length < 5) result.failures.push(request.failure()?.errorText);
  });
  try {
    try {
      const response = await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
      result.status_code = response?.status() ?? null;
    } catch (error) { result.navigation_error = error.message; }
    result.final_url = page.url();
    if (new URL(page.url()).origin !== ORIGIN && page.url() !== 'about:blank') return { ...result, status: 'external_redirect', retry: false, stop: false };
    for (let i = 0; i < 6 && !stopping; i++) {
      try {
        snapshot = await bounded(page.evaluate(() => ({ html: document.documentElement.outerHTML, title: document.title,
          text: document.body?.innerText || '', frames: [...document.querySelectorAll('iframe')].map(f => f.getAttribute('src') || '') })));
        if (challengeDetected(snapshot)) break;
        // Require summary fields or project-directory links, not just a large body.
        const ready = directory ? discoverProjects(snapshot.html).length > 0 : /<h1[\s>]/i.test(snapshot.html) && /property type|amenities|bedrooms?|residences/i.test(snapshot.text);
        if (ready && snapshot.text.length > 300) { result.readable = true; break; }
      } catch (error) { result.capture_error = error.message; }
      await sleep(1500);
    }
    const outcome = classifyResult({ status: result.status_code, challenge: snapshot && challengeDetected(snapshot), navigationError: result.navigation_error, readable: result.readable });
    Object.assign(result, outcome);
    if (snapshot) {
      result.html_file = `raw/${idFor(url)}-${Date.now()}.html`;
      await writeFile(join(folder, result.html_file), snapshot.html);
      result.title = snapshot.title;
      result.visible_characters = snapshot.text.length;
      result.html = snapshot.html;
    }
    // Screenshots are diagnostic only. They never decide collection success.
    if (result.status !== 'readable') {
      try { await page.screenshot({ path: join(folder, 'raw', `${idFor(url)}-failure.png`), timeout: 2500 }); }
      catch { result.screenshot_unavailable = true; }
    }
    return result;
  } finally { await page.close().catch(() => {}); }
}
try {
  state = await loadState(folder);
  const lastStop = state.stop_reason || (['blocked', 'rate_limited'].includes(state.runs.at(-1)?.status) ? state.runs.at(-1).status : null);
  if (lastStop && !args.includes('--resume-after-stop')) {
    throw new Error(`Previous crawl stopped: ${lastStop}. Inspect state.json; only use --resume-after-stop after access conditions have been resolved.`);
  }
  if (args.includes('--resume-after-stop')) state.stop_reason = null;
  run = { started_at: new Date().toISOString(), limit, visited: 0, collected: 0, status: 'running', browser_mode: args.includes('--headless') ? 'headless' : 'visible' };
  state.runs.push(run);
  if (args.includes('--retry-failed')) {
    for (const e of state.entries) if (['navigation_failed', 'server_error', 'insufficient_content'].includes(e.status)) e.status = 'pending';
  }
  if (args.includes('--urls')) {
    const urls = JSON.parse(await readFile(value('--urls'), 'utf8'));
    if (!Array.isArray(urls) || urls.some(u => typeof u !== 'string' || !projectUrl(u))) throw new Error('--urls must contain an array of same-site project URLs');
    enqueue(state, urls.map(u => ({ url: projectUrl(u), label: 'explicit URL' })));
  }
  await save();
  if (state.discovery && !args.includes('--discover') && !state.entries.some(e => e.status === 'pending')) {
    run.status = 'nothing_pending';
  } else {
    browser = await chromium.launch({ channel: 'chrome', headless: args.includes('--headless'), timeout: 30000 });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // Prevent a directory link/redirect from taking the top-level crawler off site.
    await context.route('**/*', route => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame().parentFrame() === null && new URL(request.url()).origin !== ORIGIN) return route.abort();
      return route.continue();
    });
    let rules = null;
    try {
      const response = await context.request.get(`${ORIGIN}/robots.txt`, { timeout: 15000, maxRedirects: 0 });
      const text = await response.text();
      await writeFile(join(folder, 'robots-response.txt'), text);
      if (response.ok() && /user-agent:/i.test(text) && !/<html|<!doctype/i.test(text)) {
        rules = robotsParser(`${ORIGIN}/robots.txt`, text);
        run.robots = 'rules_read';
      } else run.robots = 'unavailable_no_permission_inferred';
    } catch { run.robots = 'unavailable_no_permission_inferred'; }
    if (!rules) { run.status = 'robots_unavailable'; stopping = true; }
    const allowed = url => rules && rules.isAllowed(url, 'PropertyAssignmentBot') !== false;
    const pace = Math.max(2500, Number(rules?.getCrawlDelay('PropertyAssignmentBot') || 0) * 1000);
    if (!stopping && (!state.discovery || args.includes('--discover'))) {
      console.log('Discovering DarGlobal project URLs...');
      if (!allowed(`${ORIGIN}/projects`)) { run.status = 'robots_disallowed'; stopping = true; }
      else {
        await sleep(pace);
        const result = await visit(context, `${ORIGIN}/projects`, true);
        if (result.status === 'readable') {
          const pageRobots = load(result.html)('meta[name="robots"]').attr('content') || '';
          if (/nofollow|none/i.test(pageRobots)) { run.status = 'directory_nofollow'; stopping = true; }
          else {
            const links = discoverProjects(result.html);
            enqueue(state, links);
            state.discovery = { at: result.attempted_at, urls: links.length, html_file: result.html_file };
            console.log(`Discovered ${links.length} candidate project URLs.`);
          }
        } else {
          run.status = `discovery_${result.status}`; stopping = true;
          if (result.stop) state.stop_reason = result.status;
        }
        const { html, ...diagnostics } = result;
        run.discovery = diagnostics;
      }
      await save();
    }
    for (const entry of state.entries) {
      if (stopping || run.visited >= limit) break;
      if (entry.status !== 'pending') continue;
      if (!allowed(entry.url)) { entry.status = 'robots_disallowed'; await save(); continue; }
      entry.status = 'in_progress'; run.visited++;
      await save();
      console.log(`[${run.visited}/${limit}] ${entry.url}`);
      for (let attempt = 0; attempt < 2; attempt++) {
        await sleep(pace * (attempt + 1));
        if (stopping) { entry.status = 'pending'; break; }
        const result = await visit(context, entry.url);
        const { html, ...diagnostics } = result;
        diagnostics.browser_mode = run.browser_mode;
        entry.attempts.push(diagnostics);
        entry.status = result.status;
        if (result.status === 'readable') {
          const canonicalUrl = projectUrl(result.final_url);
          const parsed = canonicalUrl ? parseProject(html, canonicalUrl, result.attempted_at) : { record: null, reason: 'non_project_redirect' };
          if (parsed.record) {
            entry.record = parsed.record; entry.record.requested_url = entry.url; entry.html_file = result.html_file;
            entry.record.collection_method = `playwright_${run.browser_mode}_chrome`;
            entry.status = 'collected'; run.collected++;
          } else entry.status = parsed.reason;
        }
        await save();
        console.log(`  ${entry.status}`);
        if (result.stop) { stopping = true; run.status = result.status; state.stop_reason = result.status; break; }
        if (!result.retry || attempt === 1) break;
        entry.status = 'in_progress';
        await save();
      }
    }
    if (run.status === 'running') run.status = stopping ? 'interrupted' : state.entries.some(e => e.status === 'pending') ? 'batch_complete' : 'queue_complete';
  }
} catch (error) {
  if (run) { run.status = 'error'; run.error = error.message; }
  else console.error(error.message);
  process.exitCode = 1;
} finally {
  try {
    if (run) { run.finished_at = new Date().toISOString(); await save(); }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await lock.close(); await unlink(join(folder, '.lock'));
  }
  if (run) console.log(JSON.stringify({ ...run, output: folder }, null, 2));
  if (run && !['batch_complete', 'queue_complete', 'nothing_pending'].includes(run.status)) process.exitCode ||= run.status === 'interrupted' ? 130 : 2;
}
