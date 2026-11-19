import { loadEnvFile } from 'node:process';
import { writeFile, rename } from 'node:fs/promises';
import { loadRecords } from '../retrieval/search.mjs';
import { createChat, SYSTEM } from '../chat/answer.mjs';
import { DEFAULT_MODEL } from '../chat/openrouter.mjs';
import { STARTERS, cacheKey, normalizeQuestion } from '../chat/starter-cache.mjs';
try { loadEnvFile('.env'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const records = await loadRecords();
const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
const chat = createChat(records, { model });
const answers = {};
for (const question of STARTERS) {
  const result = await chat(question);
  if (result.status !== 'answer') throw new Error(`Starter generation failed: ${result.code || result.status}. Previous cache preserved.`);
  answers[normalizeQuestion(question)] = { statements: result.statements, model: result.model, saved_at: new Date().toISOString() };
  console.log(`Prepared: ${question}`);
}
const destination = new URL('../data/curated/starter-answers.json', import.meta.url);
const temporary = new URL('../data/curated/starter-answers.json.tmp', import.meta.url);
await writeFile(temporary, JSON.stringify({ fingerprint: cacheKey(records, SYSTEM, model), answers }, null, 2) + '\n');
await rename(temporary, destination);
console.log('Saved four validated model answers. Review their content before deploying.');
