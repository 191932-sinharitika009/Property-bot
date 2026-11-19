import { createSearch, loadRecords } from '../retrieval/search.mjs';
import { answerSearch } from '../retrieval/question.mjs';

try {
  const records = await loadRecords();
  const args = process.argv.slice(2);
  const search = createSearch(records);
  const result = args[0] === '--filters'
    ? search({ filters: JSON.parse(args[1] ?? '{}'), query: args.slice(2).join(' ') })
    : answerSearch(args.join(' '), records, search);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
