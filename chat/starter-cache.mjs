import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
export const STARTERS = ['Riyadh villas for sale below SAR 2 million', 'Les Vagues bedroom options', 'Annual apartment rentals in Jeddah', 'DarGlobal projects with a swimming pool'];
export const normalizeQuestion = question => question.trim().toLowerCase().replace(/\s+/g, ' ');
export const cacheKey = (records, prompt, model) => createHash('sha256').update(JSON.stringify({ records, prompt, model })).digest('hex');
export async function loadStarterCache() {
  try { return JSON.parse(await readFile(new URL('../data/curated/starter-answers.json', import.meta.url), 'utf8')); }
  catch { return null; }
}
