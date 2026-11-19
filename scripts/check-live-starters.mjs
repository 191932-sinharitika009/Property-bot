import { loadEnvFile } from 'node:process';
import { loadRecords } from '../retrieval/search.mjs';
import { createChat } from '../chat/answer.mjs';

try { loadEnvFile('.env'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const questions = ['Riyadh villas for sale below SAR 2 million', 'Les Vagues bedroom options',
  'Annual apartment rentals in Jeddah', 'DarGlobal projects with a swimming pool'];
const legacy = process.argv.includes('--legacy');
let requests = 0;
const chat = createChat(await loadRecords(), { fetchImpl: async (url, options) => {
  requests++;
  if (legacy) {
    const body = JSON.parse(options.body);
    body.max_tokens = 1600;
    delete body.reasoning;
    delete body.response_format;
    delete body.provider.require_parameters;
    options = { ...options, body: JSON.stringify(body) };
  }
  const response = await fetch(url, options);
  const result = await response.clone().json();
  const choice = result.choices?.[0];
  // Never print API keys, question text from external users, or model reasoning.
  console.log(JSON.stringify({ request: requests, legacy, http: response.status,
    finish: choice?.finish_reason, content_characters: choice?.message?.content?.length ?? 0,
    output_tokens: result.usage?.completion_tokens,
    reasoning_tokens: result.usage?.completion_tokens_details?.reasoning_tokens }));
  return response;
} });
for (const question of legacy ? questions.slice(0, 1) : [...questions, questions[0]]) {
  const start = Date.now();
  const result = await chat(question);
  console.log(JSON.stringify({ question, status: result.status, code: result.code,
    generated_by: result.generated_by, citations: result.sources?.length ?? 0,
    recovery_attempts: result.recovery_attempts, elapsed_ms: Date.now() - start }));
  if (result.status !== 'answer') { process.exitCode = 1; break; }
}
