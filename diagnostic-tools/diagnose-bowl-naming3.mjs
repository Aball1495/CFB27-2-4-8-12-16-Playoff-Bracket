#!/usr/bin/env node
/**
 * Diagnostic: BowlGame (on SeasonGame) references table 4313, a different
 * row per real-world bowl - this looks inside that table directly, for
 * every row relevant to the 16-team bracket's Round 1 (both the 4 native
 * slots and the 4 repurposed bowls), so we can see the actual name/branding
 * data rather than guessing from row numbers alone.
 *
 * Usage:
 *   node diagnose-bowl-naming3.mjs "<path to save>"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-bowl-naming3.mjs "<path to save>"');
  process.exit(1);
}

function decodeRef32(s) {
  if (!s || typeof s !== 'string' || s.length !== 32) return null;
  const t = parseInt(s.slice(0, 15), 2);
  const r = parseInt(s.slice(15), 2);
  if (!t && !r) return null;
  return { tableId: t, row: r };
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const seasonTables = franchise.tables.filter(t => t.name === 'SeasonGame');
  let seasonTable = seasonTables[0];
  for (const t of seasonTables) {
    if (t.header.recordCapacity > seasonTable.header.recordCapacity) seasonTable = t;
  }
  await seasonTable.readRecords();

  const recordsToCheck = {
    'Native First Round game 1 (924)': 924,
    'Native First Round game 2 (925)': 925,
    'Native First Round game 3 (926)': 926,
    'Native First Round game 4 (927)': 927,
    'Native Semifinal 1 (932)': 932,
    'Native Semifinal 2 (933)': 933,
    'Salute to Veterans Bowl (382)': 382,
    'Boca Raton Bowl (371)': 371,
    'New Orleans Bowl (375)': 375,
    'Cure Bowl (370)': 370,
  };

  // Gather all the BowlGame refs first
  const refs = {};
  for (const [label, idx] of Object.entries(recordsToCheck)) {
    const rec = seasonTable.records[idx];
    if (!rec) continue;
    const ref = decodeRef32(rec['BowlGame']);
    refs[label] = ref;
    console.log(`${label}: BowlGame -> row ${ref ? ref.row : 'null'}`);
  }

  // Now open table 4313 (or whatever tableId we actually saw) and dump the
  // full field list + values for every referenced row.
  const anyRef = Object.values(refs).find(r => r);
  if (!anyRef) { console.log('\nNo valid BowlGame refs found.'); return; }

  const bowlDefTable = franchise.getTableById(anyRef.tableId);
  await bowlDefTable.readRecords();
  const fieldNames = bowlDefTable.offsetTable.map(f => f.name);
  console.log(`\nBowlGame definition table (id ${anyRef.tableId}) field names:`, fieldNames);

  console.log('\n=== Full field dump per relevant row ===');
  const seenRows = new Set();
  for (const [label, ref] of Object.entries(refs)) {
    if (!ref || seenRows.has(ref.row)) continue;
    seenRows.add(ref.row);
    console.log(`\n-- row ${ref.row} (used by: ${label}) --`);
    const rec = bowlDefTable.records[ref.row];
    if (!rec) { console.log('  (no record)'); continue; }
    for (const f of fieldNames) {
      try {
        const v = rec[f];
        if (v !== null && v !== undefined && v !== '' && v !== 0) {
          console.log(`  ${f} = ${JSON.stringify(v)}`);
        }
      } catch {}
    }
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
