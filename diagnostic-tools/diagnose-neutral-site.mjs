#!/usr/bin/env node
/**
 * Diagnostic: list every field name on the real SeasonGame table (the
 * largest-capacity instance, same selection rule the app already uses),
 * and specifically flag anything that looks stadium/venue/site-related.
 * Also dumps the actual values of those fields for the 4 repurposed-bowl
 * Round 1 records (Salute to Veterans, Boca Raton, New Orleans, Cure) so
 * we can see what a real neutral-site bowl game currently looks like,
 * compared to a true native First Round record.
 *
 * Usage:
 *   node diagnose-neutral-site.mjs "<path to save>"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-neutral-site.mjs "<path to save>"');
  process.exit(1);
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const tables = franchise.tables.filter(t => t.name === 'SeasonGame');
  let mainTable = tables[0];
  for (const t of tables) {
    if (t.header.recordCapacity > mainTable.header.recordCapacity) mainTable = t;
  }
  console.log(`Using SeasonGame table: recordCapacity=${mainTable.header.recordCapacity}`);

  await mainTable.readRecords();
  const fieldNames = mainTable.offsetTable.map(f => f.name);
  console.log(`\nTotal fields on SeasonGame: ${fieldNames.length}`);

  const interesting = fieldNames.filter(n => /stadium|venue|site|neutral|location/i.test(n));
  console.log('\nFields matching stadium/venue/site/neutral/location:');
  interesting.forEach(n => console.log('  -', n));

  if (interesting.length === 0) {
    console.log('\nNone found on SeasonGame directly. Printing ALL field names so we can eyeball it:');
    fieldNames.forEach(n => console.log('  ', n));
    return;
  }

  // Dump these fields for: one known native First Round record (924), and
  // the 4 repurposed bowl records, so we can compare a real hosted game
  // against a real neutral-site bowl game.
  const recordsToCheck = { 'Native First Round (924)': 924, 'Native Semifinal (932)': 932 };
  // Regular bowl record indices, from REGULAR_BOWLS in playoffEditorCore.mjs
  const bowlRecords = {
    'Salute to Veterans Bowl': 382,
    'Boca Raton Bowl': 371,
    'New Orleans Bowl': 375,
    'Cure Bowl': 370,
  };
  Object.assign(recordsToCheck, bowlRecords);

  for (const [label, idx] of Object.entries(recordsToCheck)) {
    console.log(`\n=== ${label} (record ${idx}) ===`);
    const rec = mainTable.records[idx];
    if (!rec) { console.log('  (no record / empty)'); continue; }
    for (const field of interesting) {
      try {
        console.log(`  ${field} = ${JSON.stringify(rec[field])}`);
      } catch (err) {
        console.log(`  ${field} = <threw: ${err.message}>`);
      }
    }
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
