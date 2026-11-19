import { loadRecords } from '../retrieval/search.mjs';
import { evaluateRetrieval } from '../retrieval/evaluation.mjs';

const records = await loadRecords();
const cases = evaluateRetrieval(records);
console.log(JSON.stringify({ records: records.length, passed: cases.length, cases }, null, 2));
