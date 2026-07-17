#!/usr/bin/env node
/**
 * Diagnostic: check the real "BowlGame" and "GameSetup" fields (found via
 * the actual SeasonGame field list) on a true native First Round record vs
 * the 4 repurposed-bowl Round 1 records. BowlGame is likely a reference to
 * a separate table holding the bowl's identity/branding - if native games
 * have it null/different from the bowl games, that's likely the field
 * controlling what name displays.
 *
 * Usage:
 *   node diagnose-bowl-naming2.mjs "<path to save>"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-bowl-naming2.mjs "<path to save>"');
  process.exit(1);
}

const FIELDS_TO_CHECK = ['BowlGame', 'GameSetup', 'SeasonWeekType', 'IsGameOfTheWeek', 'IsChallengeGame'];

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
  await mainTable.readRecords();

  const recordsToCheck = {
    'Native First Round game 1 (924)': 924,
    'Native First Round game 2 (925)': 925,
    'Native Semifinal (932)': 932,
    'Salute to Veterans Bowl (382)': 382,
    'Boca Raton Bowl (371)': 371,
    'New Orleans Bowl (375)': 375,
    'Cure Bowl (370)': 370,
    // A couple of ordinary, definitely-not-playoff-related bowls too, as a
    // control group - if BowlGame differs between "special" and "ordinary"
    // bowls, that tells us something; if all bowls look the same regardless
    // of playoff involvement, BowlGame is probably just "which real-world
    // bowl is this" and not itself the CFP-branding switch.
    'Sun Bowl (396, ordinary)': 396,
    'Alamo Bowl (391, ordinary)': 391,
  };

  for (const [label, idx] of Object.entries(recordsToCheck)) {
    console.log(`\n=== ${label} ===`);
    const rec = mainTable.records[idx];
    if (!rec) { console.log('  (no record / empty)'); continue; }
    for (const field of FIELDS_TO_CHECK) {
      try {
        console.log(`  ${field} = ${JSON.stringify(rec[field])}`);
      } catch (err) {
        console.log(`  ${field} = <threw: ${err.message}>`);
      }
    }
  }

  // If BowlGame resolves to a reference, follow it for one native game and
  // one repurposed bowl, to see what's actually in the table it points to.
  console.log('\n=== Following BowlGame reference, if any ===');
  for (const [label, idx] of Object.entries({ 'Native (924)': 924, 'Salute to Veterans (382)': 382 })) {
    const rec = mainTable.records[idx];
    let ref;
    try { ref = rec['BowlGame']; } catch { continue; }
    if (!ref || typeof ref !== 'object' || !ref.tableId) {
      console.log(`${label}: BowlGame is not a followable reference:`, ref);
      continue;
    }
    console.log(`${label}: BowlGame -> tableId=${ref.tableId}, row=${ref.row}`);
    try {
      const targetTable = franchise.getTableById(ref.tableId);
      await targetTable.readRecords();
      const targetRec = targetTable.records[ref.row];
      const targetFields = targetTable.offsetTable.map(f => f.name);
      console.log(`  Target table field names:`, targetFields);
      for (const f of targetFields) {
        try { console.log(`    ${f} = ${JSON.stringify(targetRec[f])}`); } catch {}
      }
    } catch (err) {
      console.log('  Could not follow reference:', err.message);
    }
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
