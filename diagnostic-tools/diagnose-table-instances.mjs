#!/usr/bin/env node
/**
 * Every diagnostic so far has assumed there is exactly one "real"
 * SeasonGame table instance (the largest by recordCapacity) and every
 * other instance is a near-empty stub. This has never actually been
 * verified - if there's a SECOND large instance close in size to the one
 * we've been picking, it's possible the game's own UI reads from a
 * different instance than the one our script (and our write tool) has
 * been using, which would explain byte-identical data producing
 * different in-game results.
 *
 * Usage:
 *   node diagnose-table-instances.mjs "<path to save>"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-table-instances.mjs "<path to save>"');
  process.exit(1);
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const seasonTables = franchise.tables.filter(t => t.name === 'SeasonGame');
  console.log(`Found ${seasonTables.length} instance(s) of a table named "SeasonGame":\n`);

  const sorted = seasonTables
    .map((t, i) => ({ index: i, capacity: t.header.recordCapacity, table: t }))
    .sort((a, b) => b.capacity - a.capacity);

  for (const { index, capacity } of sorted) {
    console.log(`  instance ${index}: capacity ${capacity}`);
  }

  console.log(`\nLargest: capacity ${sorted[0].capacity}`);
  console.log(`Second largest: capacity ${sorted[1] ? sorted[1].capacity : '(none)'}`);
  if (sorted.length > 1 && sorted[1].capacity > sorted[0].capacity * 0.5) {
    console.log('\n*** WARNING: the second-largest instance is a significant fraction of the largest.');
    console.log('*** This could mean there are two real candidates, not one real table + stubs. ***');
  } else {
    console.log('\nLooks like a clean single real table + stubs, consistent with what our other scripts assume.');
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
