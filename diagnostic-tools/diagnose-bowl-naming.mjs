#!/usr/bin/env node
/**
 * Diagnostic: check IsPlayoffBowlGame (and a few related fields found in
 * the schema) on the SeasonGame table, comparing a true native First Round
 * record against the 4 repurposed-bowl Round 1 records. If there's a clean
 * true/false split, that's likely the flag controlling CFP branding
 * (e.g. "CFP First Round" vs. the bowl's own name).
 *
 * Usage:
 *   node diagnose-bowl-naming.mjs "<path to save>"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-bowl-naming.mjs "<path to save>"');
  process.exit(1);
}

const CANDIDATE_FIELDS = [
  'IsPlayoffBowlGame',
  'ChampionshipGameType',
  'CustomGameType',
  'ConfChampGameName',
  'FirstRoundCFPBowlGameResult',
  'QuarterFinalsBowlGameResult',
  'SemiFinalsBowlGameResult',
  'NationalBowlGameResult',
];

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

  const fieldNames = mainTable.offsetTable.map(f => f.name);
  const presentFields = CANDIDATE_FIELDS.filter(f => fieldNames.includes(f));
  console.log('Candidate fields actually present on SeasonGame:', presentFields);
  if (presentFields.length === 0) {
    console.log('\nNone of the candidates exist on SeasonGame directly - printing all field names:');
    fieldNames.forEach(n => console.log('  ', n));
    return;
  }

  const recordsToCheck = {
    'Native First Round game 1 (924)': 924,
    'Native First Round game 2 (925)': 925,
    'Native First Round game 3 (926)': 926,
    'Native First Round game 4 (927)': 927,
    'Native Semifinal (932)': 932,
    'Salute to Veterans Bowl (382)': 382,
    'Boca Raton Bowl (371)': 371,
    'New Orleans Bowl (375)': 375,
    'Cure Bowl (370)': 370,
  };

  for (const [label, idx] of Object.entries(recordsToCheck)) {
    console.log(`\n=== ${label} ===`);
    const rec = mainTable.records[idx];
    if (!rec) { console.log('  (no record / empty)'); continue; }
    for (const field of presentFields) {
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
