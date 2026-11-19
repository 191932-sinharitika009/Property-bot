import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { extract, isChallenge } from './extract.mjs';

const exec = promisify(execFile);
const bot = 'PropertyAssignmentBot';
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const limit = Number(option('--limit', '3'));
const selected = option('--source', 'all');
const spread = args.includes('--spread');
if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('--limit must be 1..50');
if (!['all', 'wasalt', 'darglobal'].includes(selected)) throw new Error('Unknown --source');
const runDir = new URL(`../data/runs/${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url);
await mkdir(runDir, { recursive: true });
const report = { started_at: new Date().toISOString(), limit_per_source: limit, sampling: spread ? 'evenly_spaced_sitemap_urls' : 'sitemap_order', sources: {} };
const saveReport = () => writeFile(new URL('report.json', runDir), JSON.stringify(report, null, 2));
await saveReport();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// curl uses the machine's certificate store and proxy settings. No browser spoofing,
// cookies, authentication, challenge solvers, or private endpoints are used.
async function fetchBytes(url) {
  await sleep(2000);
  const { stdout } = await exec(process.platform === 'win32' ? 'curl.exe' : 'curl', [
    '--silent', '--show-error', '--fail', '--max-time', '30',
    '--max-filesize', '15000000', '--proto', '=https',
    '--user-agent', `${bot}/0.1 (educational public property dataset)`, url
  ], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  // Redirects deliberately aren't followed: a new origin needs its own rules.
  if (!stdout.length) throw new Error('Empty response or redirect; inspect URL before retrying');
  return stdout;
}
async function fetchText(url) { return (await fetchBytes(url)).toString('utf8'); }

for (const [source, origin] of Object.entries({ darglobal: 'https://darglobal.co.uk', wasalt: 'https://wasalt.sa' })) {
  if (selected !== 'all' && selected !== source) continue;
  const state = report.sources[source] = { status: 'running', collected: 0, attempts: [], skipped: [] };
  await saveReport();
  console.log(`[${source}] Checking robots.txt`);
  try {
    const rulesText = await fetchText(`${origin}/robots.txt`);
    await writeFile(new URL(`${source}-robots.txt`, runDir), rulesText);
    if (isChallenge(rulesText) || /<html|<!doctype/i.test(rulesText) || !/user-agent:/i.test(rulesText)) {
      throw new Error('robots.txt unavailable or returned an HTML/challenge page; crawl stopped');
    }
    const rules = robotsParser(`${origin}/robots.txt`, rulesText);
    const delay = Math.max(0, Number(rules.getCrawlDelay(bot) || 0) * 1000 - 2000);
    const queue = [];
    if (source === 'wasalt') {
      // robots.txt explicitly points to this public English product sitemap.
      const sitemap = rules.getSitemaps().find(u => /product_sitemap_en/.test(u));
      if (sitemap && new URL(sitemap).hostname === 'cdn.wasalt.sa') {
        console.log(`[${source}] Reading public product sitemap`);
        const bytes = await fetchBytes(sitemap);
        const xml = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8');
        await writeFile(new URL(`${source}-sitemap.xml`, runDir), xml);
        const $ = load(xml, { xmlMode: true });
        $('url > loc').each((_, el) => {
          const u = $(el).text().trim();
          try { if (new URL(u).origin === origin) queue.push(u); } catch {}
        });
        state.discovered_urls = queue.length;
        if (spread && queue.length > limit * 2) {
          const candidates = [...new Set(queue)];
          queue.length = 0;
          const sampleSize = Math.min(candidates.length, limit * 2);
          for (let i = 0; i < sampleSize; i++) {
            queue.push(candidates[Math.floor(i * (candidates.length - 1) / (sampleSize - 1))]);
          }
          state.candidate_urls = queue.length;
        }
      }
    }
    if (!queue.length) queue.push(`${origin}/`);
    const visited = new Set();
    while (queue.length && state.collected < limit && state.attempts.length < limit * 4) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      if (rules.isAllowed(url, bot) !== true) { state.skipped.push({ url, reason: 'robots.txt' }); continue; }
      await sleep(delay);
      console.log(`[${source}] Fetching ${url}`);
      const attempt = { url };
      state.attempts.push(attempt);
      try {
        const html = await fetchText(url);
        if (isChallenge(html)) throw new Error('Access challenge detected; no data accepted');
        const { record, links, robots } = extract(html, url, source);
        if (/noindex|noarchive|nosnippet/i.test(robots)) throw new Error('Restrictive page robots directive; skipped conservatively');
        if (!record.title || record.text.length < 200) throw new Error('Insufficient readable content; requires inspection');
        await writeFile(new URL(`${source}-${record.id}.html`, runDir), html);
        await appendFile(new URL('pages.jsonl', runDir), `${JSON.stringify(record)}\n`);
        state.collected++;
        attempt.status = 'collected';
        attempt.title = record.title;
        await saveReport();
        if (source === 'darglobal') queue.push(...links.filter(u => /project|propert|portfolio|aida|simaisma/i.test(u)));
      } catch (error) {
        attempt.status = 'failed'; attempt.error = error.message;
        await saveReport();
        if (/challenge|403|429/.test(error.message)) break;
      }
    }
    state.status = state.collected ? 'sample_collected_needs_review' : 'no_records';
  } catch (error) { state.status = 'blocked'; state.error = error.message; }
  console.log(`[${source}] ${state.status}: ${state.collected} pages`);
  await saveReport();
}
report.finished_at = new Date().toISOString();
await writeFile(new URL('report.json', runDir), JSON.stringify(report, null, 2));
console.log(`Run saved: ${runDir.pathname}`);
if (!Object.values(report.sources).some(s => s.collected > 0)) process.exitCode = 2;
