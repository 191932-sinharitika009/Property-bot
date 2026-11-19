import { loadEnvFile } from 'node:process';
import { loadRecords } from '../retrieval/search.mjs';
import { createChat } from '../chat/answer.mjs';

try {
  try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const chat = createChat(await loadRecords());
  const result = await chat(process.argv.slice(2).join(' '));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'error') process.exitCode = 1;
} catch {
  console.error('Chat could not start. Check the question, local dataset, and configuration.');
  process.exitCode = 1;
}
