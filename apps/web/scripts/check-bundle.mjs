// Fails the build when the gzipped JS of the Mini App exceeds the budget (TZ 18: 500 KB, no assets).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 500;
const dir = new URL('../dist/assets/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.js') || f.endsWith('.css'));
let total = 0;
for (const file of files) {
  const size = gzipSync(readFileSync(join(dir, file))).length;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${file}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(7)} KB  total gzip (budget ${BUDGET_KB} KB)`);
if (total > BUDGET_KB * 1024) {
  console.error('bundle budget exceeded');
  process.exit(1);
}
