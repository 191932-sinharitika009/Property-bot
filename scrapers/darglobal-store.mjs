import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function atomicJson(path, data) {
  await writeFile(path + '.tmp', JSON.stringify(data, null, 2));
  await rename(path + '.tmp', path);
}
export async function loadState(folder) {
  await mkdir(folder, { recursive: true });
  try {
    const state = JSON.parse(await readFile(join(folder, 'state.json'), 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.entries)) throw new Error('Unsupported crawler state');
    for (const entry of state.entries) if (entry.status === 'in_progress') entry.status = 'pending';
    return state;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error; // Never erase a corrupt checkpoint.
    return { version: 1, created_at: new Date().toISOString(), entries: [], runs: [] };
  }
}
export function enqueue(state, links) {
  const known = new Set(state.entries.map(e => e.url));
  for (const item of links) if (!known.has(item.url)) {
    state.entries.push({ ...item, status: 'pending', attempts: [] });
    known.add(item.url);
  }
}
export async function exportRecords(folder, state) {
  const records = [...new Map(state.entries.filter(e => e.status === 'collected' && e.record)
    .map(e => [e.record.source_url || e.url, e.record])).values()];
  const text = records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  await writeFile(join(folder, 'projects.jsonl.tmp'), text);
  await rename(join(folder, 'projects.jsonl.tmp'), join(folder, 'projects.jsonl'));
  const columns = ['title', 'city', 'country', 'property_type', 'status_as_published', 'bedroom_options', 'area_range_sqm', 'area_sqm', 'price', 'currency', 'source_url', 'scraped_at', 'validation_status', 'review_issues'];
  const cell = value => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = [columns.join(','), ...records.map(r => {
    const row = { ...r, validation_status: r.validation.status, review_issues: r.validation.issues?.join('; ') || '' };
    return columns.map(key => cell(row[key])).join(',');
  })].join('\r\n');
  await writeFile(join(folder, 'projects.csv.tmp'), '\uFEFF' + csv + '\r\n');
  await rename(join(folder, 'projects.csv.tmp'), join(folder, 'projects.csv'));
  const counts = {};
  for (const e of state.entries) counts[e.status] = (counts[e.status] || 0) + 1;
  await atomicJson(join(folder, 'summary.json'), {
    generated_at: new Date().toISOString(), discovered: state.entries.length, counts,
    records: records.length, checks_passed: records.filter(r => r.validation.status === 'checks_passed').length,
    needs_review: records.filter(r => r.validation.status === 'needs_review').map(r => ({ id: r.id, issues: r.validation.issues })),
    last_reparse: state.last_reparse || null,
    latest_run: state.runs.at(-1), note: 'Collection success is not independent verification of source claims.'
  });
}
