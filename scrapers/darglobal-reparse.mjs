import { readFile, open, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { load } from 'cheerio';
import { parseProject, challengeDetected, projectUrl } from './darglobal-core.mjs';
import { loadState, atomicJson, exportRecords } from './darglobal-store.mjs';

const folder = fileURLToPath(new URL('../data/darglobal/crawl/', import.meta.url));
const lock = await open(join(folder, '.lock'), 'wx');
try {
  const state = await loadState(folder);
  let parsed = 0;
  for (const entry of state.entries) {
    const attempt = entry.attempts?.at(-1);
    if (!attempt?.html_file || attempt.status_code !== 200 || ['blocked', 'rate_limited'].includes(entry.status)) continue;
    const html = await readFile(join(folder, attempt.html_file), 'utf8');
    const $ = load(html);
    const text = $('body').text();
    if (challengeDetected({ html, text, title: $('title').text() })) continue;
    const canonicalUrl = projectUrl(attempt.final_url || entry.url);
    if (!canonicalUrl) continue;
    const result = parseProject(html, canonicalUrl, attempt.attempted_at);
    if (result.record) {
      entry.record = result.record; entry.record.requested_url = entry.url; entry.html_file = attempt.html_file;
      entry.record.collection_method = `playwright_${attempt.browser_mode || 'visible'}_chrome`;
      entry.status = 'collected'; parsed++;
    } else { entry.status = result.reason; delete entry.record; }
  }
  state.last_reparse = { at: new Date().toISOString(), parsed };
  await atomicJson(join(folder, 'state.json'), state);
  await exportRecords(folder, state);
  console.log(`Reparsed ${parsed} saved project pages without network requests.`);
} finally { await lock.close(); await unlink(join(folder, '.lock')); }
